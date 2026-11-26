const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { withTransaction, logChange, HttpError, sendError, toId, text } = require('../utils/db-helpers');
const { vigentPromosFor, bestPrice } = require('../utils/pricing');

const isAdmin = (req) => req.user.role === 'admin';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 200;
const MAX_QTY = 100000;

// ── Utilidades ────────────────────────────────────────────────

/** mysql2 entrega DECIMAL como texto: aquí se pasan a número */
const num = (v) => (v == null ? v : Number(v));
const toOrder = (o) => ({
  ...o,
  subtotal: num(o.subtotal),
  discount_total: num(o.discount_total),
  total: num(o.total),
});
const toItem = (i) => ({
  ...i,
  unit_price: num(i.unit_price),
  discount: num(i.discount),
  applied_price: num(i.applied_price),
  subtotal: num(i.subtotal),
});

/** Valida la lista de productos: [{product_id, quantity}]. Junta repetidos sumando cantidades */
function readItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'El pedido debe tener al menos un producto');
  if (raw.length > MAX_ITEMS) throw new HttpError(400, `Máximo ${MAX_ITEMS} productos por pedido`);
  const merged = new Map();
  for (const it of raw) {
    const pid = toId(it?.product_id);
    const qty = Number(it?.quantity);
    if (!pid) throw new HttpError(400, 'Producto inválido en el pedido');
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new HttpError(400, 'Las cantidades deben ser números enteros mayores que cero');
    }
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }
  return [...merged].map(([product_id, quantity]) => ({ product_id, quantity }));
}

/** El cliente debe existir, estar activo y (si es preventista) estar asignado a él */
async function checkClient(conn, req, clientId) {
  if (!clientId) throw new HttpError(400, 'Elige un cliente');
  const [rows] = await conn.query('SELECT id, preventista_id, is_active FROM clients WHERE id = ?', [clientId]);
  const c = rows[0];
  if (!c || !c.is_active || (!isAdmin(req) && c.preventista_id !== req.user.id)) {
    throw new HttpError(400, 'Cliente no válido');
  }
}

/**
 * Arma las líneas del pedido con precios calculados AQUÍ.
 * keep: líneas anteriores del pedido (al editar). Un producto que ya estaba conserva el precio
 * pactado; los productos nuevos toman el precio y la promoción vigentes hoy.
 */
async function buildLines(conn, items, keep = new Map()) {
  const ids = items.map((i) => i.product_id);
  const [prods] = await conn.query(
    'SELECT id, name, unit, current_price, stock, is_active FROM products WHERE id IN (?)',
    [ids]
  );
  const byId = new Map(prods.map((p) => [p.id, p]));
  const promos = await vigentPromosFor(conn, ids);

  const lines = [];
  const warnings = [];
  for (const { product_id, quantity } of items) {
    const p = byId.get(product_id);
    const old = keep.get(product_id);
    if (!p || (!p.is_active && !old)) throw new HttpError(400, `El producto #${product_id} no existe o está inactivo`);

    let unit_price, applied, promo_id, promo_title;
    if (old) {
      unit_price = Number(old.unit_price);
      applied = Number(old.applied_price);
      promo_id = old.promotion_id;
      promo_title = old.promotion_title;
    } else {
      unit_price = Number(p.current_price);
      const best = bestPrice(unit_price, promos.get(product_id));
      applied = best.applied;
      promo_id = best.promo?.id ?? null;
      promo_title = best.promo?.title ?? null;
    }
    lines.push({
      product_id,
      product_name: old?.product_name ?? p.name,
      unit: old?.unit ?? p.unit,
      quantity,
      unit_price,
      discount: unit_price - applied,
      applied_price: applied,
      promotion_id: promo_id,
      promotion_title: promo_title,
      subtotal: applied * quantity,
    });
    if (quantity > p.stock) {
      warnings.push({ product_id, name: p.name, stock: p.stock, quantity });
    }
  }
  const totals = {
    subtotal: lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),
    discount_total: lines.reduce((s, l) => s + l.discount * l.quantity, 0),
    total: lines.reduce((s, l) => s + l.subtotal, 0),
  };
  return { lines, warnings, totals };
}

async function insertLines(conn, orderId, lines) {
  await conn.query(
    `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, discount,
                              applied_price, promotion_id, promotion_title, subtotal) VALUES ?`,
    [lines.map((l) => [orderId, l.product_id, l.product_name, l.unit, l.quantity, l.unit_price,
                       l.discount, l.applied_price, l.promotion_id, l.promotion_title, l.subtotal])]
  );
}

/**
 * Mueve el stock: sign = -1 descuenta (confirmar), +1 devuelve (anular).
 * Al descontar, si algún producto no alcanza, NO cambia nada y responde 409 con el detalle.
 */
async function moveStock(conn, lines, sign) {
  const ids = lines.map((l) => l.product_id);
  const [rows] = await conn.query('SELECT id, name, stock FROM products WHERE id IN (?) FOR UPDATE', [ids]);
  const stock = new Map(rows.map((r) => [r.id, r]));
  if (sign < 0) {
    const shortages = lines
      .filter((l) => (stock.get(l.product_id)?.stock ?? 0) < l.quantity)
      .map((l) => ({
        product_id: l.product_id,
        name: stock.get(l.product_id)?.name ?? l.product_name,
        stock: stock.get(l.product_id)?.stock ?? 0,
        quantity: l.quantity,
      }));
    if (shortages.length > 0) {
      throw new HttpError(409, 'No hay stock suficiente para confirmar el pedido', { shortages });
    }
  }
  for (const l of lines) {
    await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [sign * l.quantity, l.product_id]);
  }
}

/** Carga el pedido (con bloqueo) y verifica que el usuario pueda verlo */
async function loadOrder(conn, req, id, lock = false) {
  const [rows] = await conn.query(`SELECT * FROM orders WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  const o = rows[0];
  if (!o || (!isAdmin(req) && o.preventista_id !== req.user.id)) throw new HttpError(404, 'Pedido no encontrado');
  const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return { order: o, items };
}

const summary = (order, items) => ({
  status: order.status,
  client_id: order.client_id,
  notes: order.notes,
  total: num(order.total),
  items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, applied_price: num(i.applied_price) })),
});

// ── GET /api/orders — preventista: los suyos; admin: todos ────
// Filtros: ?status= ?client_id= ?preventista_id= (admin) ?from=AAAA-MM-DD ?to=AAAA-MM-DD
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (!isAdmin(req)) {
      where.push('o.preventista_id = ?');
      params.push(req.user.id);
    } else if (toId(req.query.preventista_id)) {
      where.push('o.preventista_id = ?');
      params.push(toId(req.query.preventista_id));
    }
    if (['pendiente', 'confirmado', 'anulado'].includes(req.query.status)) {
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    if (toId(req.query.client_id)) {
      where.push('o.client_id = ?');
      params.push(toId(req.query.client_id));
    }
    if (DATE_RE.test(req.query.from ?? '')) {
      where.push('o.created_at >= ?');
      params.push(`${req.query.from} 00:00:00`);
    }
    if (DATE_RE.test(req.query.to ?? '')) {
      where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(req.query.to);
    }
    const [rows] = await db.query(
      `SELECT o.*, c.name AS client_name, u.name AS preventista_name,
              (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS items_count
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       JOIN users u   ON u.id = o.preventista_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 300`,
      params
    );
    res.json(rows.map(toOrder));
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/orders/:id — con sus productos ───────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Pedido no encontrado');
    const { order, items } = await loadOrder(db, req, id);
    const [[extra]] = await db.query(
      `SELECT c.name AS client_name, c.address AS client_address, c.phone AS client_phone,
              u.name AS preventista_name
       FROM clients c, users u WHERE c.id = ? AND u.id = ?`,
      [order.client_id, order.preventista_id]
    );
    res.json({ ...toOrder(order), ...extra, items: items.map(toItem) });
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/orders — crear pedido (preventista o admin) ─────
// Body: { client_id, notes?, items: [{ product_id, quantity }] }. Los precios los pone el API.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const items = readItems(req.body.items);
    const clientId = toId(req.body.client_id);
    const notes = text(req.body.notes, 'notas', 1000);

    const result = await withTransaction(async (conn) => {
      await checkClient(conn, req, clientId);
      const { lines, warnings, totals } = await buildLines(conn, items);
      const [r] = await conn.query(
        `INSERT INTO orders (preventista_id, client_id, status, notes, subtotal, discount_total, total)
         VALUES (?,?,'pendiente',?,?,?,?)`,
        [req.user.id, clientId, notes, totals.subtotal, totals.discount_total, totals.total]
      );
      await insertLines(conn, r.insertId, lines);
      await logChange(conn, req.user, 'order', r.insertId, 'create', null, {
        status: 'pendiente', client_id: clientId, notes, total: totals.total,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, applied_price: l.applied_price })),
      });
      return { id: r.insertId, total: totals.total, warnings };
    });
    res.status(201).json({ ...result, message: 'Pedido creado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PUT /api/orders/:id — editar cliente, notas y productos ───
// Preventista: solo sus pedidos PENDIENTES. Admin: pendientes o confirmados (nunca anulados).
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Pedido no encontrado');
    const items = readItems(req.body.items);
    const clientId = toId(req.body.client_id);
    const notes = text(req.body.notes, 'notas', 1000);

    const result = await withTransaction(async (conn) => {
      const { order, items: oldItems } = await loadOrder(conn, req, id, true);
      if (order.status === 'anulado') throw new HttpError(409, 'Un pedido anulado no se puede editar');
      if (!isAdmin(req) && order.status !== 'pendiente') {
        throw new HttpError(409, 'Este pedido ya fue confirmado; pídele al administrador el cambio');
      }
      await checkClient(conn, req, clientId);

      const keep = new Map(oldItems.map((i) => [i.product_id, i]));
      const { lines, warnings, totals } = await buildLines(conn, items, keep);

      // Si ya estaba confirmado, el stock se devuelve y se vuelve a descontar con las cantidades nuevas
      if (order.status === 'confirmado') {
        await moveStock(conn, oldItems, +1);
        await moveStock(conn, lines, -1);
      }

      await conn.query(
        'UPDATE orders SET client_id=?, notes=?, subtotal=?, discount_total=?, total=? WHERE id=?',
        [clientId, notes, totals.subtotal, totals.discount_total, totals.total, id]
      );
      await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);
      await insertLines(conn, id, lines);
      await logChange(conn, req.user, 'order', id, 'update', summary(order, oldItems), {
        status: order.status, client_id: clientId, notes, total: totals.total,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, applied_price: l.applied_price })),
      });
      return { total: totals.total, warnings };
    });
    res.json({ ...result, message: 'Pedido actualizado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PATCH /api/orders/:id/confirm — confirmar y descontar stock (admin)
router.patch('/:id/confirm', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Pedido no encontrado');
    await withTransaction(async (conn) => {
      const { order, items } = await loadOrder(conn, req, id, true);
      if (order.status !== 'pendiente') throw new HttpError(409, `El pedido está ${order.status}; solo se confirman pendientes`);
      await moveStock(conn, items, -1);
      await conn.query(
        "UPDATE orders SET status='confirmado', confirmed_by=?, confirmed_at=NOW() WHERE id=?",
        [req.user.name, id]
      );
      await logChange(conn, req.user, 'order', id, 'confirm', { status: 'pendiente' }, { status: 'confirmado' });
    });
    res.json({ message: 'Pedido confirmado', status: 'confirmado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PATCH /api/orders/:id/cancel — anular ─────────────────────
// Preventista: sus pedidos pendientes. Admin: cualquiera no anulado (si estaba confirmado, devuelve stock).
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Pedido no encontrado');
    const reason = text(req.body?.reason, 'motivo', 255);
    await withTransaction(async (conn) => {
      const { order, items } = await loadOrder(conn, req, id, true);
      if (order.status === 'anulado') throw new HttpError(409, 'El pedido ya está anulado');
      if (!isAdmin(req) && order.status !== 'pendiente') {
        throw new HttpError(409, 'Este pedido ya fue confirmado; solo el administrador puede anularlo');
      }
      if (order.status === 'confirmado') await moveStock(conn, items, +1);
      await conn.query(
        "UPDATE orders SET status='anulado', cancelled_by=?, cancelled_at=NOW(), cancel_reason=? WHERE id=?",
        [req.user.name, reason, id]
      );
      await logChange(conn, req.user, 'order', id, 'cancel', { status: order.status }, { status: 'anulado', reason });
    });
    res.json({ message: 'Pedido anulado', status: 'anulado' });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

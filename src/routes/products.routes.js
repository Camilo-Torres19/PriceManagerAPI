const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { withTransaction, logChange, HttpError, sendError, toId, text } = require('../utils/db-helpers');

// base_price es el PRECIO DE COSTO: solo lo ve el admin
const isAdmin = (req) => req.user.role === 'admin';
// reserved: unidades en pedidos pendientes; available: lo que de verdad se puede vender
const hideCost = (req, row) => {
  const reserved = Number(row.reserved ?? 0);
  const full = { ...row, reserved, available: row.stock - reserved };
  if (isAdmin(req)) return full;
  const { base_price, ...rest } = full;
  return rest;
};

/** Número >= 0 (o null si viene vacío). Error si no es un número válido */
function money(value, field, { required = false, positive = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `El campo ${field} es obligatorio`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) {
    throw new HttpError(400, `El campo ${field} debe ser un número ${positive ? 'mayor que cero' : 'válido'}`);
  }
  return n;
}

function stockValue(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'El stock debe ser un número entero mayor o igual a 0');
  return n;
}

/** Campos comunes de crear/editar (undefined → null, nunca llega undefined a MySQL) */
function readBody(body) {
  return {
    name:        text(body.name, 'nombre', 150, true),
    description: text(body.description, 'descripción', 2000),
    category_id: toId(body.category_id),
    brand:       text(body.brand, 'marca', 100),
    unit:        text(body.unit, 'unidad', 50) ?? 'unidad',
    base_price:  money(body.base_price, 'precio de costo'),
    stock:       stockValue(body.stock),
  };
}

// ── GET /api/products — todos los productos activos ───────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = `
      SELECT p.*, c.name AS category_name,
             (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE o.status = 'pendiente' AND i.product_id = p.id) AS reserved
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    const params = [];

    if (category) {
      sql += ' AND c.name = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (p.name LIKE ? OR p.brand LIKE ? OR c.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY p.name ASC';
    const [rows] = await db.query(sql, params);
    res.json(rows.map((r) => hideCost(req, r)));
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/products/:id ─────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, c.name AS category_name,
             (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE o.status = 'pendiente' AND i.product_id = p.id) AS reserved
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(hideCost(req, rows[0]));
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/products — crear producto (solo admin) ──────────
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const data = readBody(req.body);
    data.current_price = money(req.body.current_price, 'precio actual', { required: true, positive: true });
    data.base_price = data.base_price ?? 0;

    const id = await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO products (name, description, category_id, brand, unit, base_price, current_price, stock, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [data.name, data.description, data.category_id, data.brand, data.unit,
         data.base_price, data.current_price, data.stock, req.user.name]
      );
      await logChange(conn, req.user, 'product', result.insertId, 'create', null, data);
      return result.insertId;
    });

    res.status(201).json({ id, message: 'Producto creado exitosamente' });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'La categoría no existe' });
    sendError(res, err);
  }
});

// ── PUT /api/products/:id — actualizar producto (no cambia el precio actual)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Producto no encontrado');
    const data = readBody(req.body);

    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [id]);
      if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado');
      const before = rows[0];
      // Si no mandan costo, se conserva el que tenía
      data.base_price = data.base_price ?? Number(before.base_price);

      await conn.query(
        `UPDATE products SET name=?, description=?, category_id=?, brand=?,
         unit=?, base_price=?, stock=?, updated_by=? WHERE id=?`,
        [data.name, data.description, data.category_id, data.brand, data.unit,
         data.base_price, data.stock, req.user.name, id]
      );
      await logChange(conn, req.user, 'product', id, 'update', {
        name: before.name, description: before.description, category_id: before.category_id,
        brand: before.brand, unit: before.unit, base_price: Number(before.base_price), stock: before.stock,
      }, data);
    });
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'La categoría no existe' });
    sendError(res, err);
  }
});

// ── PATCH /api/products/:id/price — actualizar solo precio ────
// Precio + historial en la misma transacción (o se guardan los dos o ninguno)
router.patch('/:id/price', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Producto no encontrado');
    const new_price = money(req.body.new_price, 'precio', { required: true, positive: true });
    const reason = text(req.body.reason, 'motivo', 255) ?? '';

    const old_price = await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT current_price FROM products WHERE id = ? FOR UPDATE', [id]);
      if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado');
      const old = rows[0].current_price;

      await conn.query(
        'UPDATE products SET current_price = ?, updated_by = ? WHERE id = ?',
        [new_price, req.user.name, id]
      );
      await conn.query(
        'INSERT INTO price_history (product_id, old_price, new_price, changed_by, reason) VALUES (?,?,?,?,?)',
        [id, old, new_price, req.user.name, reason]
      );
      return old;
    });

    res.json({ message: 'Precio actualizado', old_price, new_price });
  } catch (err) {
    sendError(res, err);
  }
});

// ── DELETE /api/products/:id — desactivar ─────────────────────
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Producto no encontrado');
    await withTransaction(async (conn) => {
      const [r] = await conn.query('UPDATE products SET is_active = 0, updated_by = ? WHERE id = ?', [req.user.name, id]);
      if (r.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado');
      await logChange(conn, req.user, 'product', id, 'deactivate', { is_active: 1 }, { is_active: 0 });
    });
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/products/:id/history — historial de precios ──────
router.get('/:id/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM price_history WHERE product_id = ? ORDER BY changed_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

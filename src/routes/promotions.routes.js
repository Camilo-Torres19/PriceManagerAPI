const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const TYPES   = ['discount_percent', 'discount_fixed', '2x1', 'bundle'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Utilidades ────────────────────────────────────────────────

// Fecha real en formato AAAA-MM-DD (rechaza cosas como 2026-02-31)
const isDate = (s) =>
  DATE_RE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

// Valida el cuerpo de crear/editar. Devuelve { error } o { data }
function validate(body) {
  const title = String(body.title ?? '').trim();
  if (!title) return { error: 'El título es requerido' };
  if (title.length > 150) return { error: 'El título no puede pasar de 150 caracteres' };

  const type = body.type;
  if (!TYPES.includes(type)) return { error: 'Tipo de promoción inválido' };

  const value = Number(body.discount_value ?? 0);
  if (!Number.isFinite(value) || value < 0) return { error: 'Valor de descuento inválido' };
  if (type === 'discount_percent' && !(value > 0 && value <= 100)) {
    return { error: 'El porcentaje debe ser mayor que 0 y máximo 100' };
  }
  if (type === 'discount_fixed' && !(value > 0)) {
    return { error: 'El descuento en valor debe ser mayor que cero' };
  }
  // 2x1 = "lleve 2, pague 1": no usa valor de descuento
  const finalValue = type === '2x1' ? 0 : value;

  const start = body.start_date || null;
  const end   = body.end_date || null;
  if ((start && !isDate(start)) || (end && !isDate(end))) {
    return { error: 'Fechas inválidas (usa el formato AAAA-MM-DD)' };
  }
  if (start && end && end < start) {
    return { error: 'La fecha fin no puede ser anterior a la fecha de inicio' };
  }

  let ids = body.product_ids ?? [];
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return { error: 'product_ids debe ser una lista de números' };
  }
  ids = [...new Set(ids)];

  const description = String(body.description ?? '').trim() || null;
  return { data: { title, description, type, value: finalValue, start, end, ids } };
}

// Lee promociones con sus productos. Las fechas salen como 'AAAA-MM-DD' (sin zona horaria)
async function loadPromos(where = '', params = []) {
  const [promos] = await db.query(
    `SELECT p.id, p.title, p.description, p.type, p.discount_value,
            DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(p.end_date,   '%Y-%m-%d') AS end_date,
            p.is_active, p.created_by, p.created_at
     FROM promotions p ${where}
     ORDER BY p.created_at DESC, p.id DESC`,
    params
  );
  if (promos.length === 0) return [];

  const [links] = await db.query(
    'SELECT promotion_id, product_id FROM promotion_products WHERE promotion_id IN (?)',
    [promos.map((p) => p.id)]
  );
  const byPromo = new Map();
  for (const l of links) {
    if (!byPromo.has(l.promotion_id)) byPromo.set(l.promotion_id, []);
    byPromo.get(l.promotion_id).push(l.product_id);
  }
  return promos.map((p) => ({
    ...p,
    discount_value: Number(p.discount_value),
    product_ids: byPromo.get(p.id) || [],
  }));
}

// Ejecuta varias consultas como una sola operación (o todo o nada)
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function handleError(res, err) {
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'Alguno de los productos no existe' });
  }
  res.status(500).json({ error: err.message });
}

// ── GET /api/promotions — promociones activas ─────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await loadPromos('WHERE p.is_active = 1'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/promotions/all — todas (admin) ───────────────────
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    res.json(await loadPromos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/promotions — crear promoción ────────────────────
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { error, data } = validate(req.body);
    if (error) return res.status(400).json({ error });

    const id = await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO promotions (title, description, type, discount_value, start_date, end_date, is_active, created_by)
         VALUES (?,?,?,?,?,?,1,?)`,
        [data.title, data.description, data.type, data.value, data.start, data.end, req.user.name]
      );
      if (data.ids.length > 0) {
        await conn.query(
          'INSERT INTO promotion_products (promotion_id, product_id) VALUES ?',
          [data.ids.map((pid) => [r.insertId, pid])]
        );
      }
      return r.insertId;
    });

    res.status(201).json({ id, message: 'Promoción creada exitosamente' });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /api/promotions/:id — editar promoción ────────────────
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { error, data } = validate(req.body);
    if (error) return res.status(400).json({ error });

    const [rows] = await db.query('SELECT id FROM promotions WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada' });

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE promotions
         SET title = ?, description = ?, type = ?, discount_value = ?, start_date = ?, end_date = ?
         WHERE id = ?`,
        [data.title, data.description, data.type, data.value, data.start, data.end, req.params.id]
      );
      // La lista de productos se reemplaza completa
      await conn.query('DELETE FROM promotion_products WHERE promotion_id = ?', [req.params.id]);
      if (data.ids.length > 0) {
        await conn.query(
          'INSERT INTO promotion_products (promotion_id, product_id) VALUES ?',
          [data.ids.map((pid) => [Number(req.params.id), pid])]
        );
      }
    });

    res.json({ message: 'Promoción actualizada' });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PATCH /api/promotions/:id/toggle — activar/desactivar ─────
router.patch('/:id/toggle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT is_active FROM promotions WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada' });

    const newStatus = rows[0].is_active ? 0 : 1;
    await db.query('UPDATE promotions SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);

    res.json({ message: newStatus ? 'Promoción activada' : 'Promoción desactivada', is_active: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/promotions/:id ────────────────────────────────
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM promotions WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

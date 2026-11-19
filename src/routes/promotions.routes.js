const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ── GET /api/promotions — promociones activas ─────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [promos] = await db.query(
      `SELECT p.*, GROUP_CONCAT(pp.product_id) AS product_ids
       FROM promotions p
       LEFT JOIN promotion_products pp ON p.id = pp.promotion_id
       WHERE p.is_active = 1
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );

    // Parsear product_ids a array
    const result = promos.map(p => ({
      ...p,
      product_ids: p.product_ids ? p.product_ids.split(',').map(Number) : []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/promotions/all — todas (admin) ───────────────────
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [promos] = await db.query(
      `SELECT p.*, GROUP_CONCAT(pp.product_id) AS product_ids
       FROM promotions p
       LEFT JOIN promotion_products pp ON p.id = pp.promotion_id
       GROUP BY p.id ORDER BY p.created_at DESC`
    );
    const result = promos.map(p => ({
      ...p,
      product_ids: p.product_ids ? p.product_ids.split(',').map(Number) : []
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/promotions — crear promoción ────────────────────
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, description, type, discount_value, product_ids, start_date, end_date } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: 'Título y tipo son requeridos' });
    }

    const [result] = await db.query(
      `INSERT INTO promotions (title, description, type, discount_value, start_date, end_date, is_active, created_by)
       VALUES (?,?,?,?,?,?,1,?)`,
      [title, description, type, discount_value || 0, start_date, end_date, req.user.name]
    );

    const promoId = result.insertId;

    // Relacionar productos
    if (product_ids && product_ids.length > 0) {
      const values = product_ids.map(pid => [promoId, pid]);
      await db.query('INSERT INTO promotion_products (promotion_id, product_id) VALUES ?', [values]);
    }

    res.status(201).json({ id: promoId, message: 'Promoción creada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    await db.query('DELETE FROM promotions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

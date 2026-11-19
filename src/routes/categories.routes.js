const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ── GET /api/categories ───────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/categories ──────────────────────────────────────
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const [result] = await db.query(
      'INSERT INTO categories (name, icon) VALUES (?,?)',
      [name, icon || 'cube-outline']
    );
    res.status(201).json({ id: result.insertId, name, icon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

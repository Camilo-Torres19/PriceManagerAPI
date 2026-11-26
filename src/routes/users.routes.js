const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendError } = require('../utils/db-helpers');

// ── GET /api/users — lista de usuarios (admin) ────────────────
// ?role=preventista para llenar filtros y asignar clientes.
// (La gestión completa de usuarios llega en la fase 6b.)
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT id, name, email, role, zone, is_active, created_at FROM users';
    if (['admin', 'preventista'].includes(req.query.role)) {
      sql += ' WHERE role = ?';
      params.push(req.query.role);
    }
    const [rows] = await db.query(sql + ' ORDER BY name ASC', params);
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

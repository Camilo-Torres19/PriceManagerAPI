const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendError, toId } = require('../utils/db-helpers');

// ── GET /api/history — historial de cambios (admin) ───────────
// ?entity=order|client|product  ?entity_id=  ?limit= (máx 200)
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (['order', 'client', 'product'].includes(req.query.entity)) {
      where.push('entity = ?');
      params.push(req.query.entity);
    }
    if (toId(req.query.entity_id)) {
      where.push('entity_id = ?');
      params.push(toId(req.query.entity_id));
    }
    const limit = Math.min(toId(req.query.limit) ?? 50, 200);
    const [rows] = await db.query(
      `SELECT * FROM change_history ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

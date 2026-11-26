const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { withTransaction, logChange, HttpError, sendError, toId } = require('../utils/db-helpers');
const { readUser, checkPassword } = require('../utils/users');

// Todo /api/users es solo para administradores
router.use(authMiddleware, adminMiddleware);

const SELECT_USERS = `
  SELECT u.id, u.name, u.email, u.role, u.zone, u.is_active, u.created_at,
         (SELECT COUNT(*) FROM clients c WHERE c.preventista_id = u.id AND c.is_active = 1) AS clients_count,
         (SELECT COUNT(*) FROM orders o WHERE o.preventista_id = u.id AND o.status = 'pendiente') AS pending_orders
  FROM users u`;

/** Bloquea y lee el usuario (404 si no existe) */
async function lockUser(conn, id) {
  const [rows] = await conn.query(
    'SELECT id, name, email, role, zone, is_active FROM users WHERE id = ? FOR UPDATE',
    [id]
  );
  if (rows.length === 0) throw new HttpError(404, 'Usuario no encontrado');
  return rows[0];
}

/** Cuántos admins activos quedarían si este usuario deja de serlo */
async function otherActiveAdmins(conn, id) {
  const [[r]] = await conn.query(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ? FOR UPDATE",
    [id]
  );
  return Number(r.n);
}

// ── GET /api/users — lista (?role=preventista) ────────────────
router.get('/', async (req, res) => {
  try {
    const params = [];
    let sql = SELECT_USERS;
    if (['admin', 'preventista'].includes(req.query.role)) {
      sql += ' WHERE u.role = ?';
      params.push(req.query.role);
    }
    const [rows] = await db.query(sql + ' ORDER BY u.is_active DESC, u.name ASC', params);
    res.json(rows.map((r) => ({ ...r, clients_count: Number(r.clients_count), pending_orders: Number(r.pending_orders) })));
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = toId(req.params.id);
    const [rows] = await db.query(`${SELECT_USERS} WHERE u.id = ?`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'Usuario no encontrado');
    const r = rows[0];
    res.json({ ...r, clients_count: Number(r.clients_count), pending_orders: Number(r.pending_orders) });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PUT /api/users/:id — nombre, correo, rol y zona ───────────
router.put('/:id', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Usuario no encontrado');
    const data = readUser(req.body);

    await withTransaction(async (conn) => {
      const before = await lockUser(conn, id);
      if (before.role === 'admin' && data.role !== 'admin') {
        if (id === req.user.id) throw new HttpError(409, 'No puedes quitarte a ti mismo el rol de administrador');
        if (before.is_active && (await otherActiveAdmins(conn, id)) === 0) {
          throw new HttpError(409, 'Debe quedar al menos un administrador activo');
        }
      }
      const [dup] = await conn.query('SELECT id FROM users WHERE email = ? AND id <> ?', [data.email, id]);
      if (dup.length > 0) throw new HttpError(409, 'El correo ya está registrado');

      await conn.query('UPDATE users SET name = ?, email = ?, role = ?, zone = ? WHERE id = ?',
        [data.name, data.email, data.role, data.zone, id]);
      await logChange(conn, req.user, 'user', id, 'update',
        { name: before.name, email: before.email, role: before.role, zone: before.zone }, data);
    });
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
    sendError(res, err);
  }
});

// ── PATCH /api/users/:id/toggle — activar/desactivar ──────────
router.patch('/:id/toggle', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Usuario no encontrado');
    if (id === req.user.id) throw new HttpError(409, 'No puedes desactivar tu propio usuario');

    const is_active = await withTransaction(async (conn) => {
      const before = await lockUser(conn, id);
      const next = before.is_active ? 0 : 1;
      if (!next && before.role === 'admin' && (await otherActiveAdmins(conn, id)) === 0) {
        throw new HttpError(409, 'Debe quedar al menos un administrador activo');
      }
      await conn.query('UPDATE users SET is_active = ? WHERE id = ?', [next, id]);
      await logChange(conn, req.user, 'user', id, next ? 'activate' : 'deactivate',
        { is_active: before.is_active }, { is_active: next });
      return next;
    });
    res.json({ message: is_active ? 'Usuario activado' : 'Usuario desactivado', is_active });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PATCH /api/users/:id/password — restablecer contraseña ────
router.patch('/:id/password', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Usuario no encontrado');
    const hashed = await bcrypt.hash(checkPassword(req.body.password), 10);
    await withTransaction(async (conn) => {
      await lockUser(conn, id);
      await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashed, id]);
      // Nunca se guarda la contraseña (ni su hash) en el historial
      await logChange(conn, req.user, 'user', id, 'password_reset');
    });
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

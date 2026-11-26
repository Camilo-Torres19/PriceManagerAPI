const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { withTransaction, logChange, HttpError, sendError, toId, text } = require('../utils/db-helpers');

const isAdmin = (req) => req.user.role === 'admin';

const SELECT_CLIENT = `
  SELECT c.*, u.name AS preventista_name
  FROM clients c
  LEFT JOIN users u ON u.id = c.preventista_id`;

/** Valida el cuerpo de crear/editar un cliente */
function readBody(body) {
  return {
    name:         text(body.name, 'nombre', 150, true),
    contact_name: text(body.contact_name, 'contacto', 100),
    nit:          text(body.nit, 'NIT/cédula', 30),
    address:      text(body.address, 'dirección', 255),
    phone:        text(body.phone, 'teléfono', 30),
    zone:         text(body.zone, 'zona', 100),
    notes:        text(body.notes, 'notas', 1000),
  };
}

/** El preventista asignado debe existir, estar activo y tener rol preventista */
async function checkPreventista(conn, id) {
  if (id == null) return null;
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE id = ? AND role = 'preventista' AND is_active = 1",
    [id]
  );
  if (rows.length === 0) throw new HttpError(400, 'El preventista asignado no existe o está inactivo');
  return id;
}

/** Carga un cliente y verifica que el usuario pueda verlo */
async function loadClient(conn, req, id, lock = false) {
  const [rows] = await conn.query(`${SELECT_CLIENT} WHERE c.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  const c = rows[0];
  if (!c || (!isAdmin(req) && (c.preventista_id !== req.user.id || !c.is_active))) {
    throw new HttpError(404, 'Cliente no encontrado');
  }
  return c;
}

// ── GET /api/clients — preventista: los suyos; admin: todos ───
// Filtros: ?search=  ?preventista_id= (admin)  ?include_inactive=1 (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (isAdmin(req)) {
      if (req.query.include_inactive !== '1') where.push('c.is_active = 1');
      const pid = toId(req.query.preventista_id);
      if (pid) { where.push('c.preventista_id = ?'); params.push(pid); }
    } else {
      where.push('c.is_active = 1', 'c.preventista_id = ?');
      params.push(req.user.id);
    }
    const search = String(req.query.search ?? '').trim();
    if (search) {
      where.push('(c.name LIKE ? OR c.contact_name LIKE ? OR c.nit LIKE ? OR c.address LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    const sql = `${SELECT_CLIENT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name ASC`;
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/clients/:id ──────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Cliente no encontrado');
    res.json(await loadClient(db, req, id));
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/clients — preventista (queda asignado a él) o admin
router.post('/', authMiddleware, async (req, res) => {
  try {
    const data = readBody(req.body);
    const id = await withTransaction(async (conn) => {
      // El preventista siempre crea clientes para sí mismo; el admin elige (o deja sin asignar)
      data.preventista_id = isAdmin(req)
        ? await checkPreventista(conn, toId(req.body.preventista_id))
        : req.user.id;
      const [r] = await conn.query(
        `INSERT INTO clients (name, contact_name, nit, address, phone, zone, notes, preventista_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [data.name, data.contact_name, data.nit, data.address, data.phone, data.zone, data.notes,
         data.preventista_id, req.user.name]
      );
      await logChange(conn, req.user, 'client', r.insertId, 'create', null, data);
      return r.insertId;
    });
    res.status(201).json({ id, message: 'Cliente creado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PUT /api/clients/:id — preventista: solo los suyos y sin reasignar
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Cliente no encontrado');
    const data = readBody(req.body);

    await withTransaction(async (conn) => {
      const before = await loadClient(conn, req, id, true);
      data.preventista_id = isAdmin(req)
        ? await checkPreventista(conn, toId(req.body.preventista_id))
        : before.preventista_id;
      await conn.query(
        `UPDATE clients SET name=?, contact_name=?, nit=?, address=?, phone=?, zone=?, notes=?, preventista_id=?
         WHERE id = ?`,
        [data.name, data.contact_name, data.nit, data.address, data.phone, data.zone, data.notes,
         data.preventista_id, id]
      );
      await logChange(conn, req.user, 'client', id, 'update', before, data);
    });
    res.json({ message: 'Cliente actualizado' });
  } catch (err) {
    sendError(res, err);
  }
});

// ── PATCH /api/clients/:id/toggle — activar/desactivar (admin) ─
router.patch('/:id/toggle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Cliente no encontrado');
    const is_active = await withTransaction(async (conn) => {
      const before = await loadClient(conn, req, id, true);
      const next = before.is_active ? 0 : 1;
      await conn.query('UPDATE clients SET is_active = ? WHERE id = ?', [next, id]);
      await logChange(conn, req.user, 'client', id, next ? 'activate' : 'deactivate',
        { is_active: before.is_active }, { is_active: next });
      return next;
    });
    res.json({ message: is_active ? 'Cliente activado' : 'Cliente desactivado', is_active });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

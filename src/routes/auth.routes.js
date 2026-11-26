const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { withTransaction, logChange, HttpError, sendError } = require('../utils/db-helpers');
const { readUser, checkPassword } = require('../utils/users');

// ── Límite de intentos de login ───────────────────────────────
// Máximo 5 intentos fallidos por correo+IP cada 15 minutos (en memoria;
// se reinicia si se reinicia el API, suficiente para una app de este tamaño).
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();

const attemptKey = (req, email) => `${String(email).toLowerCase()}|${req.ip}`;
function isBlocked(key) {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) {
    fails.delete(key);
    return 0;
  }
  return f.count >= MAX_FAILS ? Math.ceil((f.first + WINDOW_MS - Date.now()) / 60000) : 0;
}
function registerFail(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) fails.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email ?? '').trim();
    const password = req.body.password;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const key = attemptKey(req, email);
    const minutes = isBlocked(key);
    if (minutes) {
      return res.status(429).json({ error: `Demasiados intentos. Intenta de nuevo en ${minutes} min.` });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    const user = rows[0];
    const validPassword = user ? await bcrypt.compare(String(password), user.password) : false;
    if (!validPassword) {
      registerFail(key);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    fails.delete(key);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id, name: user.name,
        email: user.email, role: user.role, zone: user.zone
      }
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/auth/register ───────────────────────────────────
// SOLO un administrador autenticado puede crear usuarios.
router.post('/register', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const data = readUser(req.body);
    const password = checkPassword(req.body.password);
    const hashedPassword = await bcrypt.hash(password, 10);

    const id = await withTransaction(async (conn) => {
      const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [data.email]);
      if (existing.length > 0) throw new HttpError(409, 'El correo ya está registrado');
      const [result] = await conn.query(
        'INSERT INTO users (name, email, password, role, zone) VALUES (?,?,?,?,?)',
        [data.name, data.email, hashedPassword, data.role, data.zone]
      );
      await logChange(conn, req.user, 'user', result.insertId, 'create', null, data);
      return result.insertId;
    });

    // No se devuelve token: el admin sigue con su propia sesión.
    res.status(201).json({ user: { id, ...data } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
    sendError(res, err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, zone, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

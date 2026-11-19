const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const ROLES = ['admin', 'preventista'];

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ? AND is_active = 1', [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

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
    res.status(500).json({ error: 'Error del servidor', detail: err.message });
  }
});

// ── POST /api/auth/register ───────────────────────────────────
// SOLO un administrador autenticado puede crear usuarios.
router.post('/register', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
    }

    const { name, email, password, role = 'preventista', zone = '' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido. Usa: admin o preventista' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, role, zone) VALUES (?,?,?,?,?)',
      [name, email, hashedPassword, role, zone]
    );

    // No se devuelve token: el admin sigue con su propia sesión.
    res.status(201).json({
      user: { id: result.insertId, name, email, role, zone }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor', detail: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

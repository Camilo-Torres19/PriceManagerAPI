const jwt = require('jsonwebtoken');
const db  = require('../config/database');

/**
 * Verifica el token Y que el usuario siga activo en la base.
 * Así, si el admin desactiva a alguien o le cambia el rol, aplica de inmediato
 * (no hay que esperar a que venza el token de 24 h).
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = ? AND is_active = 1',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Tu usuario está inactivo. Habla con el administrador.' });
    }
    // Rol y nombre salen de la base, no del token (por si cambiaron)
    req.user = rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso solo para administradores' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };

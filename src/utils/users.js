const { HttpError, text } = require('./db-helpers');

const ROLES = ['admin', 'preventista'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

/** Datos de un usuario (sin contraseña) validados */
function readUser(body) {
  const name = text(body.name, 'nombre', 100, true);
  const email = text(body.email, 'correo', 150, true).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo válido');
  const role = body.role ?? 'preventista';
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rol inválido. Usa: admin o preventista');
  const zone = text(body.zone, 'zona', 100);
  return { name, email, role, zone };
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  if (password.length > 72) throw new HttpError(400, 'La contraseña es demasiado larga (máx. 72)');
  return password;
}

module.exports = { ROLES, readUser, checkPassword, MIN_PASSWORD };

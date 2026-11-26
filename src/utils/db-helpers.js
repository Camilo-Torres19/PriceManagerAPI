const db = require('../config/database');

/** Ejecuta varias consultas como una sola operación (o todo o nada) */
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Guarda en change_history quién hizo qué y cuándo.
 * Se llama con la MISMA conexión de la transacción: si algo falla, tampoco queda el registro.
 */
async function logChange(conn, user, entity, entityId, action, before = null, after = null) {
  await conn.query(
    `INSERT INTO change_history (user_id, user_name, entity, entity_id, action, before_data, after_data)
     VALUES (?,?,?,?,?,?,?)`,
    [
      user?.id ?? null,
      user?.name ?? null,
      entity,
      entityId,
      action,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
}

/** Error con código HTTP, para cortar una operación con un mensaje claro */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Responde un error: los HttpError con su código, el resto como 500 */
function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

/** Entero positivo o null */
const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Texto recortado; vacío → null. Error si pasa del máximo */
function text(value, field, max, required = false) {
  const s = value == null ? '' : String(value).trim();
  if (!s) {
    if (required) throw new HttpError(400, `El campo ${field} es obligatorio`);
    return null;
  }
  if (s.length > max) throw new HttpError(400, `El campo ${field} no puede pasar de ${max} caracteres`);
  return s;
}

module.exports = { withTransaction, logChange, HttpError, sendError, toId, text };

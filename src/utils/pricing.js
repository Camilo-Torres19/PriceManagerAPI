// Mismas reglas que el front (promo-utils.ts / pricing.ts).
// El precio del pedido SIEMPRE lo calcula el API: nunca se confía en el precio que mande la app.

/** Precio con la promoción aplicada, redondeado al peso, nunca menor que 0 */
function discountedPrice(price, promo) {
  const v = Number(promo.discount_value);
  if (!(v > 0)) return price;
  if (promo.type === 'discount_percent') return Math.max(0, Math.round(price * (1 - v / 100)));
  if (promo.type === 'discount_fixed') return Math.max(0, Math.round(price - v));
  return price; // 2x1 / bundle: todavía no cambian el precio unitario
}

/**
 * Promociones VIGENTES hoy para esos productos.
 * Devuelve Map<product_id, promo[]> en el mismo orden que el front (más nuevas primero).
 */
async function vigentPromosFor(conn, productIds) {
  const map = new Map();
  if (productIds.length === 0) return map;
  const [rows] = await conn.query(
    `SELECT pp.product_id, p.id, p.title, p.type, p.discount_value
     FROM promotions p
     JOIN promotion_products pp ON pp.promotion_id = p.id
     WHERE p.is_active = 1
       AND (p.start_date IS NULL OR p.start_date <= CURDATE())
       AND (p.end_date   IS NULL OR p.end_date   >= CURDATE())
       AND pp.product_id IN (?)
     ORDER BY p.created_at DESC, p.id DESC`,
    [productIds]
  );
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  }
  return map;
}

/** La promoción que deja el MEJOR precio (o ninguna) */
function bestPrice(price, promos = []) {
  let applied = price;
  let promo = null;
  for (const p of promos) {
    const d = discountedPrice(price, p);
    if (d < applied) {
      applied = d;
      promo = p;
    }
  }
  return { applied, promo };
}

module.exports = { discountedPrice, vigentPromosFor, bestPrice };

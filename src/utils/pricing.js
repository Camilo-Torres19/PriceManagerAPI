// Mismas reglas que el front (promo-utils.ts / pricing.ts).
// El precio del pedido SIEMPRE lo calcula el API: nunca se confía en el precio que mande la app.

/** Precio UNITARIO con la promoción aplicada, redondeado al peso, nunca menor que 0 */
function discountedPrice(price, promo) {
  const v = Number(promo.discount_value);
  if (promo.type === 'discount_percent' && v > 0) return Math.max(0, Math.round(price * (1 - v / 100)));
  if (promo.type === 'discount_fixed' && v > 0) return Math.max(0, Math.round(price - v));
  return price; // 2x1 no cambia el precio unitario: se cobra por pares
}

/**
 * Total de una línea (precio × cantidad) con UNA promoción.
 * 2x1 = "lleve 2, pague 1" por cada par: 1→1, 2→1, 3→2, 4→2, 5→3.
 */
function lineTotal(price, qty, promo) {
  if (!promo) return price * qty;
  if (promo.type === '2x1') return price * (qty - Math.floor(qty / 2));
  return discountedPrice(price, promo) * qty;
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
       AND p.type IN ('discount_percent', 'discount_fixed', '2x1')
       AND (p.start_date IS NULL OR p.start_date <= CURDATE())
       AND (p.end_date   IS NULL OR p.end_date   >= CURDATE())
       AND pp.product_id IN (?)
     ORDER BY p.created_at DESC, p.id DESC`,
    [productIds]
  );
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push({ ...r, discount_value: Number(r.discount_value) });
  }
  return map;
}

/** La promoción que deja el MENOR total para esa cantidad (o ninguna) */
function bestForQty(price, qty, promos = []) {
  let subtotal = price * qty;
  let promo = null;
  for (const p of promos) {
    const t = lineTotal(price, qty, p);
    if (t < subtotal) {
      subtotal = t;
      promo = p;
    }
  }
  return { subtotal, promo };
}

module.exports = { discountedPrice, lineTotal, vigentPromosFor, bestForQty };

-- ════════════════════════════════════════════════════════════════
-- Promociones 2x1: cada línea del pedido guarda QUÉ promoción se aplicó
-- (tipo y valor), para recalcular bien si luego se edita la cantidad.
-- SEGURO con datos: no borra nada. Correrlo UNA sola vez
-- (si se corre dos veces, MySQL dirá "Duplicate column name": no pasa nada).
-- ════════════════════════════════════════════════════════════════
USE pricemanager;

ALTER TABLE order_items
  ADD COLUMN promotion_type  VARCHAR(30)   NULL AFTER promotion_title,
  ADD COLUMN promotion_value DECIMAL(10,2) NULL AFTER promotion_type;

-- Pedidos que ya existían: se copia el tipo y valor de su promoción (si todavía existe)
UPDATE order_items oi
JOIN promotions p ON p.id = oi.promotion_id
SET oi.promotion_type = p.type, oi.promotion_value = p.discount_value
WHERE oi.promotion_type IS NULL;

SELECT 'Migración 2x1 aplicada ✅' AS resultado;

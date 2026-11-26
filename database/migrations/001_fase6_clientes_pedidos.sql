-- ════════════════════════════════════════════════════════════════
-- Fase 6: clientes, pedidos e historial de cambios
-- SEGURO para la base con datos: NO borra nada, solo crea tablas nuevas.
-- Correrlo una sola vez (si se corre de nuevo, IF NOT EXISTS evita errores).
-- ════════════════════════════════════════════════════════════════
USE pricemanager;

-- ── Clientes (tiendas / negocios que visita el preventista) ─────
CREATE TABLE IF NOT EXISTS clients (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,          -- nombre del negocio
  contact_name    VARCHAR(100),                   -- persona de contacto
  nit             VARCHAR(30),                    -- NIT o cédula (opcional)
  address         VARCHAR(255),
  phone           VARCHAR(30),
  zone            VARCHAR(100),
  notes           TEXT,
  preventista_id  INT NULL,                       -- preventista asignado
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      VARCHAR(100),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_clients_preventista
    FOREIGN KEY (preventista_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_clients_preventista (preventista_id)
) ENGINE=InnoDB;

-- ── Pedidos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  preventista_id  INT NOT NULL,                   -- quién tomó el pedido
  client_id       INT NOT NULL,
  status          ENUM('pendiente','confirmado','anulado') NOT NULL DEFAULT 'pendiente',
  notes           TEXT,
  subtotal        DECIMAL(14,2) NOT NULL DEFAULT 0, -- suma a precio normal
  discount_total  DECIMAL(14,2) NOT NULL DEFAULT 0, -- ahorro por promociones
  total           DECIMAL(14,2) NOT NULL DEFAULT 0, -- lo que paga el cliente
  confirmed_by    VARCHAR(100),
  confirmed_at    DATETIME NULL,
  cancelled_by    VARCHAR(100),
  cancelled_at    DATETIME NULL,
  cancel_reason   VARCHAR(255),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_preventista FOREIGN KEY (preventista_id) REFERENCES users(id),
  CONSTRAINT fk_orders_client      FOREIGN KEY (client_id)      REFERENCES clients(id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_created (created_at)
) ENGINE=InnoDB;

-- ── Productos de cada pedido ────────────────────────────────────
-- Guarda el precio APLICADO en el momento del pedido: si luego cambia el precio
-- o la promoción, el pedido no se altera. Nombre y unidad se copian por lo mismo.
CREATE TABLE IF NOT EXISTS order_items (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_id         INT NOT NULL,
  product_id       INT NOT NULL,
  product_name     VARCHAR(150) NOT NULL,
  unit             VARCHAR(50),
  quantity         INT NOT NULL,
  unit_price       DECIMAL(12,2) NOT NULL,          -- precio normal por unidad
  discount         DECIMAL(12,2) NOT NULL DEFAULT 0, -- descuento por unidad
  applied_price    DECIMAL(12,2) NOT NULL,          -- precio cobrado por unidad
  promotion_id     INT NULL,
  promotion_title  VARCHAR(150),
  subtotal         DECIMAL(14,2) NOT NULL,          -- applied_price × quantity
  CONSTRAINT fk_items_order     FOREIGN KEY (order_id)     REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product   FOREIGN KEY (product_id)   REFERENCES products(id),
  CONSTRAINT fk_items_promotion FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── Historial de cambios (quién, qué, cuándo) ───────────────────
-- Los cambios de PRECIO siguen yendo a price_history (no se duplican aquí).
CREATE TABLE IF NOT EXISTS change_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  user_name   VARCHAR(100),
  entity      VARCHAR(30) NOT NULL,   -- 'order', 'client', 'product'
  entity_id   INT NOT NULL,
  action      VARCHAR(30) NOT NULL,   -- 'create', 'update', 'confirm', 'cancel', ...
  before_data JSON NULL,
  after_data  JSON NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_history_entity (entity, entity_id)
) ENGINE=InnoDB;

SELECT 'Migración fase 6 aplicada ✅' AS resultado;

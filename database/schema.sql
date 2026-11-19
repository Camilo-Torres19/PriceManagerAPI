
DROP DATABASE IF EXISTS pricemanager;
CREATE DATABASE pricemanager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pricemanager;

-- ── Usuarios ─────────────────────────────────────────────────
CREATE TABLE users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        ENUM('admin', 'preventista') NOT NULL DEFAULT 'preventista',
  zone        VARCHAR(100),
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── Categorías ───────────────────────────────────────────────
CREATE TABLE categories (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE,
  icon  VARCHAR(50)  DEFAULT 'cube-outline'
) ENGINE=InnoDB;

-- ── Productos ────────────────────────────────────────────────
CREATE TABLE products (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150)   NOT NULL,
  description   TEXT,
  category_id   INT NULL,
  brand         VARCHAR(100),
  unit          VARCHAR(50)    DEFAULT 'unidad',
  base_price    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  current_price DECIMAL(12,2)  NOT NULL DEFAULT 0,
  stock         INT            DEFAULT 0,
  image_url     VARCHAR(500),
  is_active     TINYINT(1)     DEFAULT 1,
  updated_by    VARCHAR(100),
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── Historial de precios ─────────────────────────────────────
CREATE TABLE price_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  product_id  INT NOT NULL,
  old_price   DECIMAL(12,2) NOT NULL,
  new_price   DECIMAL(12,2) NOT NULL,
  changed_by  VARCHAR(100)  NOT NULL,
  reason      VARCHAR(255),
  changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Promociones ───────────────────────────────────────────────
CREATE TABLE promotions (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(150)  NOT NULL,
  description     TEXT,
  type            ENUM('discount_percent','discount_fixed','2x1','bundle') NOT NULL,
  discount_value  DECIMAL(10,2) DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  is_active       TINYINT(1)    DEFAULT 1,
  created_by      VARCHAR(100),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── Productos en promoción ────────────────────────────────────
CREATE TABLE promotion_products (
  promotion_id  INT NOT NULL,
  product_id    INT NOT NULL,
  PRIMARY KEY (promotion_id, product_id),
  CONSTRAINT fk_pp_promotion
    FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_product
    FOREIGN KEY (product_id)   REFERENCES products(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Datos de ejemplo ─────────────────────────────────────────
INSERT INTO categories (name, icon) VALUES
  ('Aseo del hogar',   'home-outline'),
  ('Cuidado personal', 'person-outline'),
  ('Alimentos',        'fast-food-outline'),
  ('Bebidas',          'wine-outline'),
  ('Misceláneos',      'grid-outline');

-- Contraseña de ambos usuarios: password
INSERT INTO users (name, email, password, role) VALUES
  ('Administrador', 'admin@pricemanager.com',
   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
  ('Preventista Demo', 'preventista@pricemanager.com',
   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'preventista');

-- La categoría se busca por nombre (no por número fijo)
INSERT INTO products (name, description, category_id, brand, unit, base_price, current_price, stock, updated_by) VALUES
  ('Jabón Rey x3', 'Pack de 3 jabones de lavar',
    (SELECT id FROM categories WHERE name = 'Aseo del hogar'),   'Rey', 'paquete', 4500, 4800, 120, 'Admin'),
  ('Shampoo Head & Shoulders 400ml', 'Shampoo anticaspa',
    (SELECT id FROM categories WHERE name = 'Cuidado personal'), 'Head & Shoulders', 'unidad', 15000, 16500, 80, 'Admin'),
  ('Arroz Supremo 1kg', 'Arroz blanco de primera',
    (SELECT id FROM categories WHERE name = 'Alimentos'),        'Supremo', 'kg', 3200, 3500, 200, 'Admin'),
  ('Gaseosa Coca-Cola 1.5L', 'Botella personal',
    (SELECT id FROM categories WHERE name = 'Bebidas'),          'Coca-Cola', 'botella', 5000, 5500, 150, 'Admin'),
  ('Desengrasante Multiusos 500ml', 'Limpiador multiusos',
    (SELECT id FROM categories WHERE name = 'Aseo del hogar'),   'Axion', 'unidad', 8000, 8500, 60, 'Admin');

SELECT 'Base de datos creada exitosamente ✅' AS resultado;

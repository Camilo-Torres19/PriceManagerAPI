const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ── GET /api/products — todos los productos activos ───────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = `
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    const params = [];

    if (category) {
      sql += ' AND c.name = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (p.name LIKE ? OR p.brand LIKE ? OR c.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY p.name ASC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/:id ─────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products — crear producto (solo admin) ──────────
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, category_id, brand, unit, base_price, current_price, stock } = req.body;
    if (!name || !current_price) {
      return res.status(400).json({ error: 'Nombre y precio actual son requeridos' });
    }

    const [result] = await db.query(
      `INSERT INTO products (name, description, category_id, brand, unit, base_price, current_price, stock, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, description, category_id, brand, unit || 'unidad',
       base_price || current_price, current_price, stock || 0, req.user.name]
    );

    res.status(201).json({ id: result.insertId, message: 'Producto creado exitosamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/products/:id — actualizar producto ───────────────
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, category_id, brand, unit, base_price, stock } = req.body;
    await db.query(
      `UPDATE products SET name=?, description=?, category_id=?, brand=?,
       unit=?, base_price=?, stock=?, updated_by=? WHERE id=?`,
      [name, description, category_id, brand, unit, base_price, stock, req.user.name, req.params.id]
    );
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/:id/price — actualizar solo precio ────
router.patch('/:id/price', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { new_price, reason } = req.body;
    if (!new_price || new_price <= 0) {
      return res.status(400).json({ error: 'Precio inválido' });
    }

    // Obtener precio actual
    const [rows] = await db.query('SELECT current_price FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });

    const old_price = rows[0].current_price;

    // Actualizar precio
    await db.query(
      'UPDATE products SET current_price = ?, updated_by = ? WHERE id = ?',
      [new_price, req.user.name, req.params.id]
    );

    // Guardar historial
    await db.query(
      'INSERT INTO price_history (product_id, old_price, new_price, changed_by, reason) VALUES (?,?,?,?,?)',
      [req.params.id, old_price, new_price, req.user.name, reason || '']
    );

    res.json({
      message: 'Precio actualizado',
      old_price,
      new_price: parseFloat(new_price)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id — desactivar ─────────────────────
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/:id/history — historial de precios ──────
router.get('/:id/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM price_history WHERE product_id = ? ORDER BY changed_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

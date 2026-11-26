const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rutas ─────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth.routes'));
app.use('/api/products',    require('./routes/products.routes'));
app.use('/api/promotions',  require('./routes/promotions.routes'));
app.use('/api/categories',  require('./routes/categories.routes'));
app.use('/api/clients',     require('./routes/clients.routes'));
app.use('/api/orders',      require('./routes/orders.routes'));
app.use('/api/users',       require('./routes/users.routes'));
app.use('/api/history',     require('./routes/history.routes'));

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app: 'PriceManager API',
    version: '1.0.0',
    endpoints: {
      auth:        '/api/auth/login | /api/auth/register | /api/auth/me',
      products:    '/api/products | /api/products/:id | /api/products/:id/price | /api/products/:id/history',
      promotions:  '/api/promotions | /api/promotions/all',
      categories:  '/api/categories',
      clients:     '/api/clients',
      orders:      '/api/orders',
      users:       '/api/users',
      history:     '/api/history',
    }
  });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

// ── Arrancar servidor ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PriceManager API corriendo en http://localhost:${PORT}`);
  console.log(`📋 Endpoints disponibles en http://localhost:${PORT}/`);
});

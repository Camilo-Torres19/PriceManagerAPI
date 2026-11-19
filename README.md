# PriceManager API 🚀
### Node.js + Express + MySQL

---

## ⚡ Instalación local (3 pasos)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar .env
cp .env.example .env
# Edita .env con tu contraseña de MySQL

# 3. Crear la base de datos
# Abre MySQL Workbench y ejecuta: database/schema.sql
# O desde terminal:
mysql -u root -p < database/schema.sql

# 4. Correr la API
npm run dev
```

La API queda en: **http://localhost:3000**

---

## 📋 Endpoints

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/login` | Login | ❌ |
| POST | `/api/auth/register` | Registro | ❌ |
| GET  | `/api/auth/me` | Usuario actual | ✅ |
| GET  | `/api/products` | Listar productos | ✅ |
| GET  | `/api/products/:id` | Detalle producto | ✅ |
| POST | `/api/products` | Crear producto | ✅ Admin |
| PUT  | `/api/products/:id` | Editar producto | ✅ Admin |
| PATCH| `/api/products/:id/price` | Actualizar precio | ✅ Admin |
| GET  | `/api/products/:id/history` | Historial precios | ✅ |
| DELETE | `/api/products/:id` | Eliminar producto | ✅ Admin |
| GET  | `/api/promotions` | Promociones activas | ✅ |
| GET  | `/api/promotions/all` | Todas (admin) | ✅ Admin |
| POST | `/api/promotions` | Crear promoción | ✅ Admin |
| PATCH| `/api/promotions/:id/toggle` | Activar/desactivar | ✅ Admin |
| GET  | `/api/categories` | Listar categorías | ✅ |
| POST | `/api/categories` | Crear categoría | ✅ Admin |

---

## 🔑 Autenticación

Todas las rutas protegidas requieren el header:
```
Authorization: Bearer TU_JWT_TOKEN
```

---

## 📦 Subir a Railway

1. Sube este código a GitHub
2. Ve a **railway.app** → New Project → Deploy from GitHub
3. Agrega las variables de entorno en Railway:
   - `DB_HOST` → host de tu MySQL en Railway
   - `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `JWT_SECRET`
4. Railway despliega automáticamente

---

## 👥 Usuarios de prueba (ya en la BD)

| Email | Contraseña | Rol |
|-------|-----------|-----|
| admin@pricemanager.com | password | admin |
| preventista@pricemanager.com | password | preventista |

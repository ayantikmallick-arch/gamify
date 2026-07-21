/* server.js – GamifyDeals Express application */
require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const { pool }     = require('./lib/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/games',     require('./routes/games'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/dashboard', require('./routes/dashboard'));

// ── ADMIN PANEL ───────────────────────────────────────────────
// Check if first-time setup is needed
async function adminSetupCheck() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM admins');
    return parseInt(rows[0].count) === 0;
  } catch (err) {
    console.error('[Server] DB check failed:', err.message);
    return false;
  }
}

app.get('/admin', async (req, res) => {
  const setupRequired = await adminSetupCheck();
  if (setupRequired) {
    return res.sendFile(path.join(__dirname, 'admin', 'setup.html'));
  }
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/admin/setup', async (req, res) => {
  const setupRequired = await adminSetupCheck();
  // If setup already done → redirect to admin
  if (!setupRequired) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin', 'setup.html'));
});

// Admin static assets (CSS, JS) – must come AFTER named routes
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ── PUBLIC STOREFRONT ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for client-side routes (my-order, etc.)
app.get('*', (req, res) => {
  // Don't send index.html for API 404s
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║  GamifyDeals is running!               ║
  ║  Storefront : http://localhost:${PORT}     ║
  ║  Admin      : http://localhost:${PORT}/admin ║
  ╚════════════════════════════════════════╝
  `);
});

module.exports = app;

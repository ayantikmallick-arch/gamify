/* server.js – GamifyDeals Express Application */
require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const { pool }     = require('./lib/db');
const { seedDefaultAdmin } = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Seed default owner admin (Username: Ayantik / Password: Ayanjash2012.)
seedDefaultAdmin();

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/games',     require('./routes/games'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/dashboard', require('./routes/dashboard'));

// ── ADMIN PANEL ───────────────────────────────────────────────
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
  if (!setupRequired) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin', 'setup.html'));
});

// Admin static assets (CSS, JS) – must come AFTER named routes
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ── PUBLIC STOREFRONT ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for client-side routes
app.get('*', (req, res) => {
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
  ║  UPI ID     : ${process.env.UPI_ID || '9851228158@fam'}       ║
  ║  Admin User : Admin (or Ayantik)       ║
  ║  Admin Pass : Ayanjash2012.            ║
  ╚════════════════════════════════════════╝
  `);
});

module.exports = app;

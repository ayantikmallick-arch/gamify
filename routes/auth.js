/* routes/auth.js – Admin Authentication & Default Owner Setup */
const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { pool }                    = require('../lib/db');
const { requireAdmin, requireOwner } = require('../middleware/auth');
const { loginLimiter }            = require('../middleware/rateLimiter');

// ── SEED DEFAULT ADMIN (Ayantik / Ayanjash2012.) ─────────────
async function seedDefaultAdmin() {
  try {
    const { rows } = await pool.query('SELECT * FROM admins WHERE username = $1', ['Ayantik']);
    if (rows.length === 0) {
      const password_hash = await bcrypt.hash('Ayanjash2012.', 12);
      await pool.query(
        `INSERT INTO admins (username, password_hash, role)
         VALUES ($1, $2, 'owner')`,
        ['Ayantik', password_hash]
      );
      console.log('✅ Default Owner Admin initialized: Username: Ayantik');
    }
  } catch (err) {
    console.error('[Auth] Default admin seed error:', err.message);
  }
}

// ── GET /api/auth/setup-status ──────────────────────────────
router.get('/setup-status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM admins');
    res.json({ setup_required: parseInt(rows[0].count) === 0 });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ── POST /api/auth/setup ────────────────────────────────────
router.post('/setup', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM admins');
    if (parseInt(rows[0].count) > 0) {
      return res.status(403).json({ error: 'Admin already exists. Setup is disabled.' });
    }

    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { rows: [admin] } = await pool.query(
      `INSERT INTO admins (username, password_hash, role)
       VALUES ($1, $2, 'owner')
       RETURNING id, username, role`,
      [username.trim(), password_hash]
    );

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET
    );

    res.cookie('admin_token', token, cookieOptions());
    res.json({ success: true, admin: { username: admin.username, role: admin.role } });
  } catch (err) {
    console.error('[Auth] Setup error:', err);
    res.status(500).json({ error: 'Setup failed. Check server logs.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }

    // Exact case-sensitive match for username
    const { rows } = await pool.query(
      'SELECT * FROM admins WHERE username = $1',
      [username.trim()]
    );

    const dummyHash = '$2b$12$invalidhashfortimingprotection00000000000000000000000';
    const hash      = rows[0]?.password_hash || dummyHash;
    const valid     = await bcrypt.compare(password, hash);

    if (!rows[0] || !valid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const admin = rows[0];
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET
    );

    res.cookie('admin_token', token, cookieOptions());
    res.json({ success: true, admin: { username: admin.username, role: admin.role } });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

// ── GET /api/auth/me ────────────────────────────────────────
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

// ── POST /api/auth/change-password ─────────────────────────
router.post('/change-password', requireAdmin, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new password required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [newHash, req.admin.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed.' });
  }
});

// ── POST /api/auth/admins (owner only) ─────────────────────
router.post('/admins', requireAdmin, requireOwner, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password too short.' });

    const password_hash = await bcrypt.hash(password, 12);
    const { rows: [admin] } = await pool.query(
      `INSERT INTO admins (username, password_hash, role)
       VALUES ($1, $2, 'admin') RETURNING id, username, role, created_at`,
      [username.trim(), password_hash]
    );
    res.status(201).json(admin);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
    res.status(500).json({ error: 'Failed to create admin.' });
  }
});

// ── GET /api/auth/admins (owner only) ──────────────────────
router.get('/admins', requireAdmin, requireOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, created_at FROM admins ORDER BY created_at'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admins.' });
  }
});

// ── DELETE /api/auth/admins/:id (owner only) ───────────────
router.delete('/admins/:id', requireAdmin, requireOwner, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.admin.id) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }
    await pool.query('DELETE FROM admins WHERE id = $1 AND role != $2', [req.params.id, 'owner']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete admin.' });
  }
});

// ── HELPERS ─────────────────────────────────────────────────
function cookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000 // 7 days
  };
}

module.exports = router;
module.exports.seedDefaultAdmin = seedDefaultAdmin;

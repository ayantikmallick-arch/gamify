/* routes/orders.js – Manual UPI QR Orders & Approval Workflow */
const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { pool }           = require('../lib/db');
const { requireAdmin }   = require('../middleware/auth');
const { decrypt }        = require('../lib/crypto');
const { generateUpiUrl, generateQrDataUrl, getUpiConfig } = require('../lib/upi');
const { insertLog }      = require('../lib/auditLog');
const { orderCreateLimiter, revealLimiter } = require('../middleware/rateLimiter');

// ── HELPERS ──────────────────────────────────────────────────
function getViewToken(req) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token || null;
}

function verifyViewToken(token, order_id) {
  try {
    const decoded = jwt.verify(token, process.env.ORDER_TOKEN_SECRET);
    return decoded.order_id === order_id;
  } catch {
    return false;
  }
}

function makeViewToken(order_id) {
  return jwt.sign({ order_id }, process.env.ORDER_TOKEN_SECRET);
}

// Helper to ensure a game exists in PostgreSQL before linking to orders
async function ensureGameExists(gameId, amount) {
  if (!gameId) return null;
  const numericId = parseInt(gameId);

  // Check if exists by ID or steam_app_id
  const { rows: existing } = await pool.query(
    'SELECT id FROM games WHERE id = $1 OR steam_app_id = $1',
    [numericId]
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Create game entry automatically if missing
  const { rows: [newGame] } = await pool.query(
    `INSERT INTO games (name, price, steam_app_id, active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id`,
    [`Game #${numericId}`, parseFloat(amount), numericId]
  );

  return newGame.id;
}

// ── POST /api/orders/create – public ───────────────────────
// Creates order & generates dynamic UPI QR Code
router.post('/create', orderCreateLimiter, async (req, res) => {
  try {
    const { game_id, buyer_email, buyer_name, buyer_whatsapp, amount } = req.body;

    if (!buyer_email || !amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Valid buyer_email and amount are required.' });
    }

    // Ensure foreign key exists in PostgreSQL
    const validDbGameId = await ensureGameExists(game_id, amount);

    const { rows: [order] } = await pool.query(
      `INSERT INTO orders
         (buyer_email, buyer_name, buyer_whatsapp, game_id, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending_approval')
       RETURNING id`,
      [
        buyer_email.trim().toLowerCase(),
        buyer_name     ? buyer_name.trim()     : null,
        buyer_whatsapp ? buyer_whatsapp.trim() : null,
        validDbGameId,
        parseFloat(amount)
      ]
    );

    const view_token = makeViewToken(order.id);
    await pool.query('UPDATE orders SET view_token = $1 WHERE id = $2', [view_token, order.id]);

    const upiUrl   = generateUpiUrl({ amount, orderId: order.id });
    const qrDataUrl = await generateQrDataUrl(upiUrl);
    const upiConfig = getUpiConfig();

    res.json({
      order_id:       order.id,
      view_token,
      amount:         parseFloat(amount),
      currency:       'INR',
      upi_id:         upiConfig.upiId,
      upi_name:       upiConfig.upiName,
      upi_url:        upiUrl,
      qr_code_data_url: qrDataUrl,
      buyer_email,
      buyer_name:     buyer_name || ''
    });
  } catch (err) {
    console.error('[Orders] Create error:', err);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// ── POST /api/orders/submit-utr – public ────────────────────
// Customer submits 12-digit UPI UTR / Reference ID
router.post('/submit-utr', async (req, res) => {
  try {
    const { order_id, token, utr_number } = req.body;

    if (!order_id || !utr_number || !utr_number.trim()) {
      return res.status(400).json({ error: 'order_id and 12-digit UTR number are required.' });
    }

    if (!token || !verifyViewToken(token, order_id)) {
      return res.status(401).json({ error: 'Invalid order access token.' });
    }

    const trimmedUtr = utr_number.trim();

    const { rows: [order] } = await pool.query(
      `UPDATE orders
       SET utr_number = $1
       WHERE id = $2
       RETURNING id, buyer_email, amount, view_token`,
      [trimmedUtr, order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await insertLog({
      order_id: order.id,
      action:   'order_created',
      actor:    order.buyer_email,
      meta:     { utr_number: trimmedUtr, amount: order.amount }
    });

    res.json({
      success:      true,
      order_id:     order.id,
      view_token:   order.view_token,
      redirect_url: `/my-order.html?order_id=${order.id}&token=${order.view_token}`
    });
  } catch (err) {
    console.error('[Orders] Submit UTR error:', err);
    res.status(500).json({ error: 'Failed to submit UTR number.' });
  }
});

// ── GET /api/orders/my/:order_id – customer view token access
router.get('/my/:order_id', async (req, res) => {
  try {
    const token = getViewToken(req);
    if (!token || !verifyViewToken(token, req.params.order_id)) {
      return res.status(401).json({ error: 'Invalid or missing access token.' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.buyer_whatsapp, o.amount, o.currency,
              o.utr_number, o.status, o.created_at, o.approved_at,
              o.assigned_username,
              g.name AS game_name, g.emoji, g.genre, g.steam_app_id
       FROM orders o
       LEFT JOIN games g ON g.id = o.game_id
       WHERE o.id = $1`,
      [req.params.order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const upiConfig = getUpiConfig();

    res.json({
      id:                 order.id,
      buyer_email:        order.buyer_email,
      buyer_name:         order.buyer_name,
      buyer_whatsapp:     order.buyer_whatsapp,
      amount:             order.amount,
      currency:           order.currency,
      utr_number:         order.utr_number,
      upi_id:             upiConfig.upiId,
      status:             order.status,
      created_at:         order.created_at,
      approved_at:        order.approved_at,
      game_name:          order.game_name,
      emoji:              order.emoji,
      genre:              order.genre,
      steam_app_id:       order.steam_app_id,
      assigned_username:  order.assigned_username,
      has_credentials:    !!(order.assigned_username && order.status === 'delivered')
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order details.' });
  }
});

// ── POST /api/orders/my/:order_id/reveal – customer decrypts credentials ─
router.post('/my/:order_id/reveal', revealLimiter, async (req, res) => {
  try {
    const token = getViewToken(req);
    if (!token || !verifyViewToken(token, req.params.order_id)) {
      return res.status(401).json({ error: 'Invalid access token.' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT o.id, o.game_id, o.buyer_email, o.status,
              o.assigned_username, o.assigned_password_enc, o.assigned_iv, o.assigned_auth_tag
       FROM orders o
       WHERE o.id = $1`,
      [req.params.order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'Order is not delivered yet. Payment verification pending.' });
    }

    if (!order.assigned_password_enc) {
      return res.status(400).json({ error: 'No Steam credentials assigned to this order yet.' });
    }

    const steam_password = decrypt({
      ciphertext: order.assigned_password_enc,
      iv:         order.assigned_iv,
      authTag:    order.assigned_auth_tag
    });

    await insertLog({
      game_id:  order.game_id,
      order_id: order.id,
      action:   'revealed_customer',
      actor:    order.buyer_email,
      meta:     { ip: req.ip }
    });

    res.json({
      steam_username: order.assigned_username,
      steam_password
    });
  } catch (err) {
    console.error('[Orders] Customer reveal error:', err);
    res.status(500).json({ error: 'Failed to retrieve Steam credentials.' });
  }
});

// ── GET /api/orders – admin order list ──────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status, search, page = 1 } = req.query;
    const limit  = 20;
    const offset = (parseInt(page) - 1) * limit;
    const conditions = [];
    const params = [];

    if (status) { params.push(status); conditions.push(`o.status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(o.buyer_email ILIKE $${params.length} OR o.buyer_name ILIKE $${params.length} OR o.utr_number ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countParams = [...params];
    params.push(limit, offset);

    const { rows: orders } = await pool.query(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.buyer_whatsapp,
              o.amount, o.currency, o.utr_number, o.status, o.created_at, o.approved_at,
              o.assigned_username, o.approved_by,
              g.name AS game_name, g.emoji
       FROM orders o
       LEFT JOIN games g ON g.id = o.game_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM orders o ${where}`,
      countParams
    );

    const { rows: [{ pending_count }] } = await pool.query(
      `SELECT COUNT(*) AS pending_count FROM orders WHERE status = 'pending_approval'`
    );

    res.json({
      orders,
      total:         parseInt(count),
      pending_count: parseInt(pending_count),
      page:          parseInt(page),
      pages:         Math.ceil(parseInt(count) / limit)
    });
  } catch (err) {
    console.error('[Orders] Admin list error:', err);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// ── GET /api/orders/:id – admin order details ──────────────
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT o.*, g.name AS game_name, g.emoji, g.steam_app_id
       FROM orders o
       LEFT JOIN games g ON g.id = o.game_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// ── POST /api/orders/:id/approve – Admin Approve & Deliver ──
router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { account_id } = req.body;

    const { rows: [order] } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    let targetAccount = null;

    if (account_id) {
      const { rows: [acc] } = await pool.query('SELECT * FROM game_accounts WHERE id = $1', [account_id]);
      targetAccount = acc;
    } else if (order.game_id) {
      const { rows: [acc] } = await pool.query(
        'SELECT * FROM game_accounts WHERE game_id = $1 AND active = TRUE ORDER BY id ASC LIMIT 1',
        [order.game_id]
      );
      targetAccount = acc;
    }

    if (!targetAccount) {
      return res.status(400).json({
        error: 'No active Steam account slot found for this game. Please click "+ Add New Game" or "🔑 Steam Slots" in the Games tab to add a Steam username & password first.'
      });
    }

    await pool.query(
      `UPDATE orders
       SET status                = 'delivered',
           assigned_account_id   = $1,
           assigned_username     = $2,
           assigned_password_enc = $3,
           assigned_iv           = $4,
           assigned_auth_tag     = $5,
           approved_at           = NOW(),
           approved_by           = $6
       WHERE id = $7`,
      [
        targetAccount.id,
        targetAccount.steam_username,
        targetAccount.steam_password_enc,
        targetAccount.steam_iv,
        targetAccount.steam_auth_tag,
        req.admin.username,
        order.id
      ]
    );

    await insertLog({
      game_id:  order.game_id,
      order_id: order.id,
      action:   'approved_delivered',
      actor:    req.admin.username,
      meta:     { assigned_username: targetAccount.steam_username, utr: order.utr_number }
    });

    res.json({ success: true, message: 'Order approved and delivered successfully!' });
  } catch (err) {
    console.error('[Orders] Approve error:', err);
    res.status(500).json({ error: 'Failed to approve order.' });
  }
});

// ── POST /api/orders/:id/reject – Admin Reject Order ───────
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;

    const { rows: [order] } = await pool.query(
      `UPDATE orders
       SET status      = 'rejected',
           admin_notes = $1,
           approved_at = NOW(),
           approved_by = $2
       WHERE id = $3
       RETURNING *`,
      [reason || 'UTR Verification Failed', req.admin.username, req.params.id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await insertLog({
      game_id:  order.game_id,
      order_id: order.id,
      action:   'rejected',
      actor:    req.admin.username,
      meta:     { reason: reason || 'UTR Verification Failed' }
    });

    res.json({ success: true, message: 'Order rejected.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject order.' });
  }
});

// ── POST /api/orders/:id/reveal – Admin Reveal Credentials ──
router.post('/:id/reveal', requireAdmin, async (req, res) => {
  try {
    const { rows: [order] } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.assigned_password_enc) {
      return res.status(400).json({ error: 'No Steam credentials assigned to this order yet.' });
    }

    const steam_password = decrypt({
      ciphertext: order.assigned_password_enc,
      iv:         order.assigned_iv,
      authTag:    order.assigned_auth_tag
    });

    await insertLog({
      game_id:  order.game_id,
      order_id: order.id,
      action:   'revealed_admin',
      actor:    req.admin.username
    });

    res.json({
      steam_username: order.assigned_username,
      steam_password
    });
  } catch (err) {
    res.status(500).json({ error: 'Admin reveal failed.' });
  }
});

module.exports = router;

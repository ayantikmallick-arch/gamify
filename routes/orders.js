/* routes/orders.js – Manual UPI QR Orders & Approval Workflow with Server-Side Price Verification */
const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const fs     = require('fs');
const path   = require('path');
const { pool }           = require('../lib/db');
const { requireAdmin }   = require('../middleware/auth');
const { decrypt }        = require('../lib/crypto');
const { generateUpiUrl, generateQrDataUrl, getUpiConfig } = require('../lib/upi');
const { insertLog }      = require('../lib/auditLog');
const { orderCreateLimiter, revealLimiter } = require('../middleware/rateLimiter');

// ── LOAD BACKEND CATALOG AS SOURCE OF TRUTH ──────────────────
let BACKEND_GAMES_CATALOG = [];
try {
  const catalogCode = fs.readFileSync(path.join(__dirname, '../public/games.js'), 'utf8');
  // Safely extract catalog
  const match = catalogCode.match(/const\s+GAMES_DATA\s*=\s*(\[\s*[\s\S]*?\]);/);
  if (match) {
    BACKEND_GAMES_CATALOG = eval(match[1]);
  }
} catch (err) {
  console.error('[Orders] Failed to load server games.js catalog:', err.message);
}

// Get Server-Side Official Price
function getOfficialPrice(gameId, gameName) {
  const numericId = parseInt(gameId);

  if (numericId && !isNaN(numericId)) {
    const found = BACKEND_GAMES_CATALOG.find(g => g.id === numericId);
    if (found && found.price) return parseFloat(found.price);
  }

  if (gameName) {
    const cleanName = gameName.trim().toLowerCase();
    const found = BACKEND_GAMES_CATALOG.find(g => g.name.toLowerCase() === cleanName);
    if (found && found.price) return parseFloat(found.price);
  }

  return null;
}

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

// Helper to ensure a game exists in PostgreSQL with its REAL CATALOG NAME and OFFICIAL PRICE
async function ensureGameExists(gameId, officialPrice, gameNameFromClient) {
  if (!gameId && !gameNameFromClient) return null;
  const numericId = parseInt(gameId);

  // 1. Check if exists in DB by ID or steam_app_id
  if (numericId && !isNaN(numericId)) {
    const { rows: existing } = await pool.query(
      'SELECT id, name, price FROM games WHERE id = $1 OR steam_app_id = $1',
      [numericId]
    );

    if (existing.length > 0) {
      if (existing[0].name.startsWith('Game #') && gameNameFromClient) {
        await pool.query('UPDATE games SET name = $1, price = $2 WHERE id = $3', [gameNameFromClient.trim(), officialPrice, existing[0].id]);
      }
      return existing[0].id;
    }
  }

  // 2. Check if exists by name
  const finalName = gameNameFromClient?.trim() || `Game #${numericId || Date.now()}`;
  const { rows: byName } = await pool.query('SELECT id FROM games WHERE LOWER(name) = LOWER($1)', [finalName]);
  if (byName.length > 0) return byName[0].id;

  // 3. Create game entry automatically with real name & official price
  const { rows: [newGame] } = await pool.query(
    `INSERT INTO games (name, price, steam_app_id, active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id`,
    [finalName, officialPrice, numericId || null]
  );

  return newGame.id;
}

// ── POST /api/orders/create – public ───────────────────────
// SERVER-SIDE PRICE ENFORCEMENT (DevTools Tamper Proof)
router.post('/create', orderCreateLimiter, async (req, res) => {
  try {
    const { game_id, game_name, buyer_email, buyer_name, buyer_whatsapp } = req.body;

    if (!buyer_email) {
      return res.status(400).json({ error: 'Valid buyer_email is required.' });
    }

    // 🛡️ SERVER-SIDE PRICE SECURITY:
    // Determine official price from DB or Server Catalog (IGNORE ANY CLIENT SUBMITTED PRICE)
    let officialPrice = getOfficialPrice(game_id, game_name);

    if (!officialPrice) {
      // Check database for existing game price
      if (game_id) {
        const { rows: [dbGame] } = await pool.query('SELECT price FROM games WHERE id = $1 OR steam_app_id = $1', [parseInt(game_id)]);
        if (dbGame && dbGame.price) officialPrice = parseFloat(dbGame.price);
      }
    }

    // Fallback standard price if game not found in catalog
    if (!officialPrice || isNaN(officialPrice)) {
      officialPrice = 149.00;
    }

    // Ensure foreign key exists in PostgreSQL with real name & official price
    const validDbGameId = await ensureGameExists(game_id, officialPrice, game_name);

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
        officialPrice
      ]
    );

    const view_token = makeViewToken(order.id);
    await pool.query('UPDATE orders SET view_token = $1 WHERE id = $2', [view_token, order.id]);

    // Generate UPI QR Code with OFFICIAL SERVER PRICE
    const upiUrl   = generateUpiUrl({ amount: officialPrice, orderId: order.id });
    const qrDataUrl = await generateQrDataUrl(upiUrl);
    const upiConfig = getUpiConfig();

    res.json({
      order_id:       order.id,
      view_token,
      amount:         officialPrice,
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
// Customer submits UTR & Payer Account Name
router.post('/submit-utr', async (req, res) => {
  try {
    const { order_id, token, utr_number, payer_name } = req.body;

    if (!order_id || !utr_number || !utr_number.trim()) {
      return res.status(400).json({ error: 'order_id and UTR transaction reference number are required.' });
    }

    const cleanUtr = utr_number.trim().replace(/[\s-]/g, '');
    if (cleanUtr.length < 12 || cleanUtr.length > 18 || !/^[a-zA-Z0-9]{12,18}$/.test(cleanUtr)) {
      return res.status(400).json({ error: 'UPI Transaction Reference / UTR must be exactly 12 to 18 digits.' });
    }

    if (!token || !verifyViewToken(token, order_id)) {
      return res.status(401).json({ error: 'Invalid order access token.' });
    }

    const trimmedUtr   = utr_number.trim();
    const trimmedPayer = payer_name ? payer_name.trim() : null;

    const { rows: [order] } = await pool.query(
      `UPDATE orders
       SET utr_number = $1,
           buyer_name = COALESCE($2, buyer_name)
       WHERE id = $3
       RETURNING id, buyer_email, buyer_name, amount, view_token`,
      [trimmedUtr, trimmedPayer, order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await insertLog({
      order_id: order.id,
      action:   'order_created',
      actor:    order.buyer_email,
      meta:     { utr_number: trimmedUtr, payer_name: trimmedPayer, amount: order.amount }
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

// ── GET /api/orders/customer-history – customer order history by email
router.get('/customer-history', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const { rows } = await pool.query(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.amount, o.currency,
              o.utr_number, o.status, o.created_at, o.approved_at, o.view_token,
              g.name AS game_name, g.emoji, g.genre, g.steam_app_id
       FROM orders o
       LEFT JOIN games g ON g.id = o.game_id
       WHERE LOWER(o.buyer_email) = $1
       ORDER BY o.created_at DESC`,
      [cleanEmail]
    );

    res.json(rows);
  } catch (err) {
    console.error('[Orders] Customer history error:', err);
    res.status(500).json({ error: 'Failed to fetch order history.' });
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
        error: 'No active Steam account slot found for this game. Please click "+ Add New Game" in the Games tab to add a Steam username & password first.'
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

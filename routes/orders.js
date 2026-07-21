/* routes/orders.js */
const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { pool }           = require('../lib/db');
const { requireAdmin }   = require('../middleware/auth');
const { decrypt }        = require('../lib/crypto');
const { getInstance: getRazorpay, verifySignature } = require('../lib/razorpay');
const { insertLog }      = require('../lib/auditLog');
const { orderCreateLimiter, orderVerifyLimiter, revealLimiter } = require('../middleware/rateLimiter');

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
  // No expiry — intentional per design spec
  return jwt.sign({ order_id }, process.env.ORDER_TOKEN_SECRET);
}

// ── POST /api/orders/create – public ───────────────────────
router.post('/create', orderCreateLimiter, async (req, res) => {
  try {
    const { game_id, buyer_email, buyer_name, buyer_whatsapp, cart_items, amount } = req.body;

    if (!buyer_email || !amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'buyer_email and valid amount are required.' });
    }

    const rzp          = getRazorpay();
    const amountPaise  = Math.round(parseFloat(amount) * 100); // INR → paise

    const rzpOrder = await rzp.orders.create({
      amount:          amountPaise,
      currency:        'INR',
      receipt:         `gd_${Date.now()}`,
      payment_capture: 1
    });

    const { rows: [order] } = await pool.query(
      `INSERT INTO orders
         (buyer_email, buyer_name, buyer_whatsapp, game_id, amount, razorpay_order_id, cart_items)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        buyer_email,
        buyer_name     || null,
        buyer_whatsapp || null,
        game_id        ? parseInt(game_id) : null,
        parseFloat(amount),
        rzpOrder.id,
        cart_items     ? JSON.stringify(cart_items) : null
      ]
    );

    res.json({
      order_id:    order.id,
      rzp_order_id: rzpOrder.id,
      key_id:      process.env.RAZORPAY_KEY_ID,
      amount:      amountPaise,
      currency:    'INR',
      buyer_email,
      buyer_name:  buyer_name || ''
    });
  } catch (err) {
    console.error('[Orders] Create error:', err);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// ── POST /api/orders/verify – public ───────────────────────
// 1) Verify HMAC signature
// 2) Open transaction + SELECT FOR UPDATE SKIP LOCKED
// 3) Assign inventory, mark order paid
// 4) Issue no-expiry view_token
// 5) Redirect URL returned – credentials NOT in response
router.post('/verify', orderVerifyLimiter, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Incomplete payment details.' });
  }

  // Step 1: Verify HMAC-SHA256 signature
  let sigValid = false;
  try {
    sigValid = verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  } catch {
    return res.status(400).json({ error: 'Signature verification error.' });
  }

  if (!sigValid) {
    // Mark the internal order as failed
    await pool.query(
      "UPDATE orders SET status = 'failed' WHERE razorpay_order_id = $1",
      [razorpay_order_id]
    ).catch(() => {});
    return res.status(400).json({ error: 'Payment signature is invalid.' });
  }

  // Step 2: Find pending order
  const { rows: [order] } = await pool.query(
    "SELECT * FROM orders WHERE razorpay_order_id = $1 AND status = 'pending'",
    [razorpay_order_id]
  );

  if (!order) {
    return res.status(409).json({ error: 'Order not found or already processed.' });
  }

  // Step 3: Assign inventory inside a transaction with row lock
  const client = await pool.connect();
  let inventory_id = null;

  try {
    await client.query('BEGIN');

    if (order.game_id) {
      const { rows: [inv] } = await client.query(
        `SELECT id FROM inventory
         WHERE game_id = $1 AND status = 'available'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [order.game_id]
      );

      if (inv) {
        await client.query(
          `UPDATE inventory
           SET status = 'sold', order_id = $1, sold_at = NOW()
           WHERE id = $2`,
          [order.id, inv.id]
        );
        inventory_id = inv.id;
      }
      // If no inventory available: order still marked paid, admin must assign manually
    }

    // Step 4: Generate no-expiry view token
    const view_token = makeViewToken(order.id);

    await client.query(
      `UPDATE orders
       SET status               = 'paid',
           razorpay_payment_id  = $1,
           razorpay_signature   = $2,
           inventory_id         = $3,
           view_token           = $4,
           paid_at              = NOW()
       WHERE id = $5`,
      [razorpay_payment_id, razorpay_signature, inventory_id, view_token, order.id]
    );

    await client.query('COMMIT');

    // Audit log (outside transaction – fire-and-forget)
    if (inventory_id) {
      await insertLog({
        inventory_id, game_id: order.game_id, order_id: order.id,
        action: 'sold', actor: 'system',
        meta: { razorpay_payment_id }
      });
    }

    res.json({
      success:       true,
      order_id:      order.id,
      view_token,
      out_of_stock:  !inventory_id, // admin will manually assign
      redirect_url:  `/my-order.html?order_id=${order.id}&token=${view_token}`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Orders] Verify transaction error:', err);
    res.status(500).json({ error: 'Failed to process payment. Contact support with your payment ID.' });
  } finally {
    client.release();
  }
});

// ── GET /api/orders/my/:order_id – public with view token ──
// Returns order metadata — no credentials
router.get('/my/:order_id', async (req, res) => {
  try {
    const token = getViewToken(req);
    if (!token || !verifyViewToken(token, req.params.order_id)) {
      return res.status(401).json({ error: 'Invalid or missing access token.' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.amount, o.currency,
              o.status, o.created_at, o.paid_at,
              o.inventory_id,
              g.name AS game_name, g.emoji, g.genre, g.steam_app_id,
              i.steam_username
       FROM orders o
       LEFT JOIN games   g ON g.id  = o.game_id
       LEFT JOIN inventory i ON i.id = o.inventory_id
       WHERE o.id = $1`,
      [req.params.order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    res.json({
      id:             order.id,
      buyer_email:    order.buyer_email,
      buyer_name:     order.buyer_name,
      amount:         order.amount,
      currency:       order.currency,
      status:         order.status,
      created_at:     order.created_at,
      paid_at:        order.paid_at,
      game_name:      order.game_name,
      emoji:          order.emoji,
      genre:          order.genre,
      steam_app_id:   order.steam_app_id,
      steam_username: order.steam_username, // show username as preview
      has_inventory:  !!order.inventory_id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// ── POST /api/orders/my/:order_id/reveal – public ──────────
// Customer explicitly clicks "Reveal" — decrypt and return credentials
// Rate limited: 3 reveals per 10 min per IP
router.post('/my/:order_id/reveal', revealLimiter, async (req, res) => {
  try {
    const token = getViewToken(req);
    if (!token || !verifyViewToken(token, req.params.order_id)) {
      return res.status(401).json({ error: 'Invalid access token.' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT o.id, o.inventory_id, o.game_id, o.buyer_email, o.status,
              i.steam_username, i.steam_password_enc, i.steam_iv, i.steam_auth_tag
       FROM orders o
       LEFT JOIN inventory i ON i.id = o.inventory_id
       WHERE o.id = $1`,
      [req.params.order_id]
    );

    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.status !== 'paid') return res.status(400).json({ error: 'Order is not paid.' });
    if (!order.inventory_id) {
      return res.status(202).json({
        pending: true,
        message: 'Your credentials are being prepared. Please check back in a few minutes or contact WhatsApp support.'
      });
    }

    const steam_password = decrypt({
      ciphertext: order.steam_password_enc,
      iv:         order.steam_iv,
      authTag:    order.steam_auth_tag
    });

    await insertLog({
      inventory_id: order.inventory_id, game_id: order.game_id, order_id: order.id,
      action: 'revealed_customer', actor: order.buyer_email,
      meta:   { ip: req.ip }
    });

    res.json({
      steam_username: order.steam_username,
      steam_password
    });
  } catch (err) {
    console.error('[Orders] Customer reveal error:', err);
    res.status(500).json({ error: 'Failed to retrieve credentials. Contact support.' });
  }
});

// ── GET /api/orders – admin list ────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status, search, page = 1 } = req.query;
    const limit  = 20;
    const offset = (parseInt(page) - 1) * limit;
    const conditions = [];
    const params = [];

    if (status) { params.push(status);       conditions.push(`o.status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(o.buyer_email ILIKE $${params.length} OR o.buyer_name ILIKE $${params.length} OR o.razorpay_payment_id ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countParams = [...params];
    params.push(limit, offset);

    const { rows: orders } = await pool.query(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.buyer_whatsapp,
              o.amount, o.currency, o.status, o.created_at, o.paid_at,
              o.razorpay_payment_id, o.razorpay_order_id,
              g.name AS game_name, g.emoji,
              i.steam_username,
              o.inventory_id IS NOT NULL AS has_inventory
       FROM orders o
       LEFT JOIN games     g ON g.id = o.game_id
       LEFT JOIN inventory i ON i.id = o.inventory_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM orders o ${where}`,
      countParams
    );

    res.json({
      orders,
      total: parseInt(count),
      page:  parseInt(page),
      pages: Math.ceil(parseInt(count) / limit)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// ── GET /api/orders/:id – admin detail ──────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT o.*, g.name AS game_name, g.emoji, g.steam_app_id,
              i.steam_username, i.status AS inventory_status
       FROM orders o
       LEFT JOIN games g ON g.id = o.game_id
       LEFT JOIN inventory i ON i.id = o.inventory_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// ── POST /api/orders/:id/reveal – admin ─────────────────────
router.post('/:id/reveal', requireAdmin, async (req, res) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT o.id, o.inventory_id, o.game_id,
              i.steam_username, i.steam_password_enc, i.steam_iv, i.steam_auth_tag
       FROM orders o
       LEFT JOIN inventory i ON i.id = o.inventory_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order)            return res.status(404).json({ error: 'Order not found.' });
    if (!order.inventory_id) return res.status(400).json({ error: 'No inventory assigned to this order.' });

    const steam_password = decrypt({
      ciphertext: order.steam_password_enc,
      iv:         order.steam_iv,
      authTag:    order.steam_auth_tag
    });

    await insertLog({
      inventory_id: order.inventory_id, game_id: order.game_id, order_id: order.id,
      action: 'revealed_admin', actor: req.admin.username
    });

    res.json({
      steam_username: order.steam_username,
      steam_password
    });
  } catch (err) {
    console.error('[Orders] Admin reveal error:', err);
    res.status(500).json({ error: 'Reveal failed.' });
  }
});

// ── POST /api/orders/:id/assign-inventory – admin manual assign
router.post('/:id/assign-inventory', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { inventory_id } = req.body;
    if (!inventory_id) return res.status(400).json({ error: 'inventory_id required.' });

    await client.query('BEGIN');

    const { rows: [inv] } = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND status = 'available' FOR UPDATE`,
      [inventory_id]
    );
    if (!inv) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Inventory item not available or already assigned.' });
    }

    await client.query(
      `UPDATE inventory SET status='sold', order_id=$1, sold_at=NOW() WHERE id=$2`,
      [req.params.id, inventory_id]
    );
    await client.query(
      `UPDATE orders SET inventory_id=$1 WHERE id=$2`,
      [inventory_id, req.params.id]
    );

    await client.query('COMMIT');

    await insertLog({
      inventory_id, game_id: inv.game_id, order_id: req.params.id,
      action: 'assigned', actor: req.admin.username,
      meta: { manual: true }
    });

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Assignment failed.' });
  } finally {
    client.release();
  }
});

module.exports = router;

/* routes/dashboard.js – Stats & Live Notification Feed */
const router = require('express').Router();
const { pool }        = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');

// ── GET /api/dashboard/stats ────────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [revenue, ordersStats, recentOrders, topGames] = await Promise.all([

      pool.query(`
        SELECT
          COALESCE(SUM(amount), 0)                                              AS total_revenue,
          COALESCE(SUM(amount) FILTER (WHERE approved_at > NOW() - INTERVAL '7 days'), 0) AS revenue_7d,
          COALESCE(SUM(amount) FILTER (WHERE approved_at > NOW() - INTERVAL '30 days'), 0) AS revenue_30d,
          COUNT(*) FILTER (WHERE status = 'delivered')                          AS total_orders,
          COUNT(*) FILTER (WHERE status = 'pending_approval')                   AS pending_approval
        FROM orders`),

      pool.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'delivered')                            AS delivered,
               COUNT(*) FILTER (WHERE status = 'pending_approval')                     AS pending,
               COUNT(*) FILTER (WHERE status = 'rejected')                             AS rejected
        FROM orders`),

      pool.query(`
        SELECT o.id, o.buyer_email, o.amount, o.utr_number, o.status, o.created_at, o.approved_at,
               g.name AS game_name, g.emoji
        FROM orders o
        LEFT JOIN games g ON g.id = o.game_id
        ORDER BY o.created_at DESC
        LIMIT 8`),

      pool.query(`
        SELECT g.id, g.name, g.emoji,
               COUNT(o.id)     AS order_count,
               SUM(o.amount)   AS revenue
        FROM orders o
        LEFT JOIN games g ON g.id = o.game_id
        WHERE o.status = 'delivered'
        GROUP BY g.id, g.name, g.emoji
        ORDER BY order_count DESC
        LIMIT 5`)
    ]);

    res.json({
      revenue:           revenue.rows[0],
      order_stats:       ordersStats.rows[0],
      recent_orders:     recentOrders.rows,
      top_games:         topGames.rows
    });
  } catch (err) {
    console.error('[Dashboard] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
  }
});

// ── GET /api/dashboard/audit-log ────────────────────────────
router.get('/audit-log', requireAdmin, async (req, res) => {
  try {
    const { action, page = 1 } = req.query;
    const limit  = 50;
    const offset = (parseInt(page) - 1) * limit;
    const params = [];
    let where = '';

    if (action) {
      params.push(action);
      where = `WHERE l.action = $${params.length}`;
    }

    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT l.*, g.name AS game_name
       FROM inventory_logs l
       LEFT JOIN games g ON g.id = l.game_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

module.exports = router;

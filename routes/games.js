/* routes/games.js */
const router = require('express').Router();
const { pool }        = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');

// ── GET /api/games – public (storefront) ───────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*,
              COUNT(i.id) FILTER (WHERE i.status = 'available') AS available_count
       FROM games g
       LEFT JOIN inventory i ON i.game_id = g.id
       WHERE g.active = TRUE
       GROUP BY g.id
       ORDER BY g.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[Games] List error:', err);
    res.status(500).json({ error: 'Failed to fetch games.' });
  }
});

// ── GET /api/games/admin – admin list with inventory counts ─
router.get('/admin/list', requireAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = '';

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE g.name ILIKE $1 OR g.genre ILIKE $1`;
    }

    const { rows } = await pool.query(
      `SELECT g.*,
              COUNT(i.id) FILTER (WHERE i.status = 'available') AS available_count,
              COUNT(i.id) FILTER (WHERE i.status = 'sold')      AS sold_count,
              COUNT(i.id)                                        AS total_inventory
       FROM games g
       LEFT JOIN inventory i ON i.game_id = g.id
       ${where}
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch games.' });
  }
});

// ── POST /api/games – create ────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, genre, sub_genre, steam_app_id, price, original_price, badge, emoji, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Game name is required.' });
    if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'Valid price is required.' });

    const { rows: [game] } = await pool.query(
      `INSERT INTO games (name, genre, sub_genre, steam_app_id, price, original_price, badge, emoji, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        name.trim(),
        genre         || null,
        sub_genre     || null,
        steam_app_id  ? parseInt(steam_app_id) : null,
        parseFloat(price),
        original_price ? parseFloat(original_price) : null,
        badge         || null,
        emoji         || '🎮',
        description   || null
      ]
    );
    res.status(201).json(game);
  } catch (err) {
    console.error('[Games] Create error:', err);
    res.status(500).json({ error: 'Failed to create game.' });
  }
});

// ── PUT /api/games/:id – update ─────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, genre, sub_genre, steam_app_id, price, original_price, badge, emoji, description, active } = req.body;
    const { rows: [game] } = await pool.query(
      `UPDATE games SET
         name           = COALESCE($1, name),
         genre          = $2,
         sub_genre      = $3,
         steam_app_id   = $4,
         price          = COALESCE($5, price),
         original_price = $6,
         badge          = $7,
         emoji          = COALESCE($8, emoji),
         description    = $9,
         active         = COALESCE($10, active)
       WHERE id = $11
       RETURNING *`,
      [
        name?.trim()  || null,
        genre         || null,
        sub_genre     || null,
        steam_app_id  ? parseInt(steam_app_id) : null,
        price         ? parseFloat(price) : null,
        original_price ? parseFloat(original_price) : null,
        badge         || null,
        emoji         || null,
        description   || null,
        active !== undefined ? Boolean(active) : null,
        req.params.id
      ]
    );
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update game.' });
  }
});

// ── DELETE /api/games/:id ───────────────────────────────────
// Soft-delete if inventory exists, hard-delete if clean
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [inv] } = await pool.query(
      'SELECT COUNT(*) FROM inventory WHERE game_id = $1',
      [req.params.id]
    );
    if (parseInt(inv.count) > 0) {
      await pool.query('UPDATE games SET active = FALSE WHERE id = $1', [req.params.id]);
      return res.json({ success: true, type: 'soft', message: 'Game hidden (has inventory). Delete inventory first to remove fully.' });
    }
    await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
    res.json({ success: true, type: 'hard' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete game.' });
  }
});

module.exports = router;

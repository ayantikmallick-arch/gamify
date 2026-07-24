/* routes/games.js – Game Catalog, Game Requests & Multi-Slot Steam Credentials Management */
const router = require('express').Router();
const { pool }          = require('../lib/db');
const { requireAdmin }   = require('../middleware/auth');
const { encrypt, decrypt } = require('../lib/crypto');
const { insertLog }      = require('../lib/auditLog');

// ── GET /api/games – public storefront ─────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*,
              COUNT(ga.id) FILTER (WHERE ga.active = TRUE) AS active_slots_count
       FROM games g
       LEFT JOIN game_accounts ga ON ga.game_id = g.id
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

// ── POST /api/games/request-game – Public Game Request ──
router.post('/request-game', async (req, res) => {
  try {
    const { game_title, email, whatsapp } = req.body;
    if (!game_title || !game_title.trim()) {
      return res.status(400).json({ error: 'Game title is required.' });
    }
    const cleanTitle = game_title.trim();
    const cleanEmail = email ? email.trim() : 'Anonymous';

    await insertLog({
      action: 'game_requested',
      actor:  cleanEmail,
      meta:   { game_title: cleanTitle, whatsapp: whatsapp || null, time: new Date().toISOString() }
    });

    res.json({ success: true, message: `Your request for "${cleanTitle}" has been received!` });
  } catch (err) {
    console.error('[Games] Request game error:', err);
    res.status(500).json({ error: 'Failed to submit game request.' });
  }
});

// ── GET /api/games/admin/requests – List all Customer Game Requests ──
router.get('/admin/requests', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, action, actor, meta, created_at
       FROM inventory_logs
       WHERE action = 'game_requested'
       ORDER BY created_at DESC`
    );
    const requests = rows.map(r => ({
      id: r.id,
      customer: r.actor,
      game_title: r.meta?.game_title || 'Unknown Game',
      whatsapp: r.meta?.whatsapp || null,
      created_at: r.created_at
    }));
    res.json(requests);
  } catch (err) {
    console.error('[Games] Fetch requests error:', err);
    res.status(500).json({ error: 'Failed to fetch game requests.' });
  }
});

// ── GET /api/games/admin/list – admin panel ─────────────────
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
              COUNT(ga.id) FILTER (WHERE ga.active = TRUE) AS total_slots
       FROM games g
       LEFT JOIN game_accounts ga ON ga.game_id = g.id
       ${where}
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch games for admin.' });
  }
});

// ── POST /api/games/add-with-account – Unified Add Game & Steam Account ──
router.post('/add-with-account', requireAdmin, async (req, res) => {
  try {
    const { name, genre, sub_genre, steam_app_id, price, original_price, badge, emoji, description, steam_username, steam_password, slot_name } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Game name is required.' });
    if (!steam_username?.trim() || !steam_password?.trim()) {
      return res.status(400).json({ error: 'Steam username and password are required.' });
    }

    const gameName = name.trim();
    let game = null;

    const { rows: existing } = await pool.query('SELECT * FROM games WHERE LOWER(name) = LOWER($1)', [gameName]);

    if (existing.length > 0) {
      game = existing[0];
    } else {
      const { rows: [newGame] } = await pool.query(
        `INSERT INTO games (name, genre, sub_genre, steam_app_id, price, original_price, badge, emoji, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          gameName,
          genre || 'Action',
          sub_genre || null,
          steam_app_id ? parseInt(steam_app_id) : null,
          price ? parseFloat(price) : 149,
          original_price ? parseFloat(original_price) : 1799,
          badge || null,
          emoji || '🎮',
          description || null
        ]
      );
      game = newGame;
    }

    const enc = encrypt(steam_password.trim());
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM game_accounts WHERE game_id = $1', [game.id]);
    const defaultSlotName = slot_name?.trim() || `Slot ${parseInt(count) + 1}`;

    const { rows: [account] } = await pool.query(
      `INSERT INTO game_accounts (game_id, slot_name, steam_username, steam_password_enc, steam_iv, steam_auth_tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slot_name, steam_username`,
      [game.id, defaultSlotName, steam_username.trim(), enc.ciphertext, enc.iv, enc.authTag]
    );

    res.status(201).json({
      success: true,
      game,
      account
    });
  } catch (err) {
    console.error('[Games] Add with account error:', err);
    res.status(500).json({ error: 'Failed to save game and Steam account.' });
  }
});

// ── PUT /api/games/:id – update game details ────────────────
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
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete game.' });
  }
});

// ── GET /api/games/:id/accounts – List all Steam Account Slots for a Game
router.get('/:id/accounts', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ga.id, ga.game_id, ga.slot_name, ga.steam_username, ga.notes, ga.active, ga.created_at,
              ga.steam_password_enc, ga.steam_iv, ga.steam_auth_tag
       FROM game_accounts ga
       WHERE ga.game_id = $1
       ORDER BY ga.id ASC`,
      [req.params.id]
    );

    const accounts = rows.map(acc => {
      let password = '';
      try {
        password = decrypt({
          ciphertext: acc.steam_password_enc,
          iv:         acc.steam_iv,
          authTag:    acc.steam_auth_tag
        });
      } catch (e) {
        password = '[Decryption Error]';
      }
      return {
        id:             acc.id,
        slot_name:      acc.slot_name,
        steam_username: acc.steam_username,
        steam_password: password,
        notes:          acc.notes,
        active:         acc.active,
        created_at:     acc.created_at
      };
    });

    res.json(accounts);
  } catch (err) {
    console.error('[Games] Fetch accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch Steam accounts for this game.' });
  }
});

// ── POST /api/games/:id/accounts – Add or Update a Steam Account Slot ──
router.post('/:id/accounts', requireAdmin, async (req, res) => {
  try {
    const { slot_name, steam_username, steam_password, notes, account_id } = req.body;

    if (!steam_username?.trim() || !steam_password?.trim()) {
      return res.status(400).json({ error: 'Steam username and password are required.' });
    }

    const enc = encrypt(steam_password.trim());
    const slotName = slot_name?.trim() || 'Slot 1';

    if (account_id) {
      const { rows: [acc] } = await pool.query(
        `UPDATE game_accounts
         SET slot_name          = $1,
             steam_username     = $2,
             steam_password_enc = $3,
             steam_iv          = $4,
             steam_auth_tag    = $5,
             notes              = $6
         WHERE id = $7 AND game_id = $8
         RETURNING id, slot_name, steam_username`,
        [slotName, steam_username.trim(), enc.ciphertext, enc.iv, enc.authTag, notes || null, account_id, req.params.id]
      );
      return res.json({ success: true, account: acc });
    } else {
      const { rows: [acc] } = await pool.query(
        `INSERT INTO game_accounts (game_id, slot_name, steam_username, steam_password_enc, steam_iv, steam_auth_tag, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, slot_name, steam_username`,
        [req.params.id, slotName, steam_username.trim(), enc.ciphertext, enc.iv, enc.authTag, notes || null]
      );
      return res.status(201).json({ success: true, account: acc });
    }
  } catch (err) {
    console.error('[Games] Add/Update account slot error:', err);
    res.status(500).json({ error: 'Failed to save Steam account slot.' });
  }
});

// ── DELETE /api/games/accounts/:accountId – Delete Account Slot ──
router.delete('/accounts/:accountId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM game_accounts WHERE id = $1', [req.params.accountId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account slot.' });
  }
});

module.exports = router;

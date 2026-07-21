/* routes/inventory.js */
const router     = require('express').Router();
const multer     = require('multer');
const csvParser  = require('csv-parser');
const { Readable } = require('stream');
const { pool }          = require('../lib/db');
const { requireAdmin }  = require('../middleware/auth');
const { encrypt }       = require('../lib/crypto');
const { insertLog }     = require('../lib/auditLog');
const { csvImportLimiter } = require('../middleware/rateLimiter');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    if (!file.originalname.match(/\.csv$/i)) {
      return cb(new Error('Only CSV files are accepted'));
    }
    cb(null, true);
  }
});

// ── GET /api/inventory ──────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { game_id, status, search, page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;
    const conditions = [];
    const params = [];

    if (game_id) { params.push(game_id);       conditions.push(`i.game_id = $${params.length}`); }
    if (status)  { params.push(status);         conditions.push(`i.status = $${params.length}`); }
    if (search)  { params.push(`%${search}%`);  conditions.push(`(i.steam_username ILIKE $${params.length} OR g.name ILIKE $${params.length})`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT i.id, i.game_id, g.name AS game_name, i.steam_username,
              i.status, i.order_id, i.created_at, i.sold_at
       FROM inventory i
       LEFT JOIN games g ON g.id = i.game_id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: [total] } = await pool.query(
      `SELECT COUNT(*) FROM inventory i LEFT JOIN games g ON g.id = i.game_id ${where}`,
      params.slice(0, -2)
    );

    res.json({ items: rows, total: parseInt(total.count), page: parseInt(page) });
  } catch (err) {
    console.error('[Inventory] List error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory.' });
  }
});

// ── POST /api/inventory – add single item ───────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { game_id, steam_username, steam_password } = req.body;
    if (!game_id || !steam_username?.trim() || !steam_password?.trim()) {
      return res.status(400).json({ error: 'game_id, steam_username, and steam_password are required.' });
    }

    const enc = encrypt(steam_password.trim());
    const { rows: [item] } = await pool.query(
      `INSERT INTO inventory (game_id, steam_username, steam_password_enc, steam_iv, steam_auth_tag)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, game_id, steam_username, status, created_at`,
      [game_id, steam_username.trim(), enc.ciphertext, enc.iv, enc.authTag]
    );

    await insertLog({
      inventory_id: item.id, game_id, action: 'imported',
      actor: req.admin.username, meta: { method: 'single' }
    });

    res.status(201).json(item);
  } catch (err) {
    console.error('[Inventory] Add error:', err);
    res.status(500).json({ error: 'Failed to add inventory item.' });
  }
});

// ── POST /api/inventory/import-csv ─────────────────────────
router.post(
  '/import-csv',
  requireAdmin,
  csvImportLimiter,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });

    const results = [];
    const errors  = [];

    try {
      // Parse CSV from memory buffer
      await new Promise((resolve, reject) => {
        const stream = Readable.from(req.file.buffer.toString('utf-8'));
        stream
          .pipe(csvParser({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
          .on('data', row => results.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      if (!results.length) {
        return res.status(400).json({ error: 'CSV file is empty or malformed.' });
      }

      const inserted = [];

      for (const [idx, row] of results.entries()) {
        const game_id        = (row.game_id || '').trim();
        const steam_username = (row.steam_username || '').trim();
        const steam_password = (row.steam_password || '').trim();
        const lineNum = idx + 2; // +1 for 0-index, +1 for header row

        if (!game_id || !steam_username || !steam_password) {
          errors.push({ row: lineNum, error: 'Missing game_id, steam_username, or steam_password' });
          continue;
        }

        try {
          const enc = encrypt(steam_password);
          const { rows: [item] } = await pool.query(
            `INSERT INTO inventory (game_id, steam_username, steam_password_enc, steam_iv, steam_auth_tag)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [parseInt(game_id), steam_username, enc.ciphertext, enc.iv, enc.authTag]
          );

          await insertLog({
            inventory_id: item.id, game_id: parseInt(game_id),
            action: 'imported', actor: req.admin.username,
            meta: { method: 'csv', row: lineNum }
          });

          inserted.push(item.id);
        } catch (e) {
          errors.push({ row: lineNum, error: e.message });
        }
      }

      res.json({
        success:  true,
        inserted: inserted.length,
        failed:   errors.length,
        errors
      });
    } catch (err) {
      console.error('[Inventory] CSV import error:', err);
      res.status(500).json({ error: 'CSV processing failed.' });
    }
  }
);

// ── GET /api/inventory/template.csv ────────────────────────
router.get('/template.csv', requireAdmin, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send([
    'game_id,steam_username,steam_password',
    '1,example_username1,example_password1',
    '1,example_username2,example_password2',
    '2,example_username3,example_password3'
  ].join('\n'));
});

// ── GET /api/inventory/:id/logs ─────────────────────────────
router.get('/:id/logs', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, g.name AS game_name
       FROM inventory_logs l
       LEFT JOIN games g ON g.id = l.game_id
       WHERE l.inventory_id = $1
       ORDER BY l.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

// ── DELETE /api/inventory/:id ───────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Inventory item not found.' });

    const item = rows[0];
    if (item.status === 'sold') {
      return res.status(400).json({ error: 'Cannot delete sold inventory. It is linked to a paid order.' });
    }

    await pool.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
    await insertLog({
      inventory_id: item.id, game_id: item.game_id,
      action: 'deleted', actor: req.admin.username,
      meta: { steam_username: item.steam_username }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete inventory item.' });
  }
});

// ── POST /api/inventory/:id/replace ─────────────────────────
// Replace Steam credentials on any inventory item (e.g. after account issue)
router.post('/:id/replace', requireAdmin, async (req, res) => {
  try {
    const { steam_username, steam_password } = req.body;
    if (!steam_username?.trim() || !steam_password?.trim()) {
      return res.status(400).json({ error: 'New steam_username and steam_password are required.' });
    }

    const enc = encrypt(steam_password.trim());
    const { rows: [item] } = await pool.query(
      `UPDATE inventory
       SET steam_username    = $1,
           steam_password_enc = $2,
           steam_iv          = $3,
           steam_auth_tag    = $4
       WHERE id = $5
       RETURNING id, game_id, order_id, status`,
      [steam_username.trim(), enc.ciphertext, enc.iv, enc.authTag, req.params.id]
    );

    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });

    await insertLog({
      inventory_id: item.id, game_id: item.game_id, order_id: item.order_id,
      action: 'replaced', actor: req.admin.username,
      meta: { new_username: steam_username.trim() }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Replace failed.' });
  }
});

module.exports = router;

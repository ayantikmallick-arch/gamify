/* lib/auditLog.js – Write events to inventory_logs table */
const { pool } = require('./db');

/**
 * Insert an audit log entry.
 * Fire-and-forget – never throws (errors logged to console).
 *
 * @param {object} opts
 * @param {number}  [opts.game_id]
 * @param {string}  [opts.order_id]     – UUID
 * @param {string}   opts.action        – 'order_created'|'approved_delivered'|'rejected'|'revealed_customer'|'revealed_admin'
 * @param {string}  [opts.actor]        – username or 'system'
 * @param {object}  [opts.meta]         – extra JSONB data
 */
async function insertLog({ game_id, order_id, action, actor, meta } = {}) {
  try {
    await pool.query(
      `INSERT INTO inventory_logs (game_id, order_id, action, actor, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        game_id      || null,
        order_id     || null,
        action,
        actor        || 'system',
        meta ? JSON.stringify(meta) : null
      ]
    );
  } catch (err) {
    console.error('[AuditLog] Failed to write log:', err.message);
  }
}

module.exports = { insertLog };

/* middleware/auth.js – JWT admin authentication */
const jwt = require('jsonwebtoken');

/**
 * Require a valid admin JWT.
 * Token read from httpOnly cookie OR Authorization: Bearer header.
 */
function requireAdmin(req, res, next) {
  const token =
    req.cookies?.admin_token ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

/**
 * Require the admin to have the "owner" role.
 * Must be used AFTER requireAdmin.
 */
function requireOwner(req, res, next) {
  if (req.admin?.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required for this action.' });
  }
  next();
}

module.exports = { requireAdmin, requireOwner };

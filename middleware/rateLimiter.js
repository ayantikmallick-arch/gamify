/* middleware/rateLimiter.js – Per-route rate limit configurations */
const rateLimit = require('express-rate-limit');

const createLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message:         { error: message },
    standardHeaders: true,
    legacyHeaders:   false,
    // Use X-Forwarded-For if behind a proxy/nginx
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip
  });

// 10 attempts per 15 minutes – brute-force protection on login
const loginLimiter = createLimiter(
  15 * 60 * 1000,
  10,
  'Too many login attempts. Try again in 15 minutes.'
);

// 20 order creations per minute per IP
const orderCreateLimiter = createLimiter(
  60 * 1000,
  20,
  'Too many order requests. Please slow down.'
);

// 20 payment verifications per minute per IP
const orderVerifyLimiter = createLimiter(
  60 * 1000,
  20,
  'Too many verification requests. Please slow down.'
);

// 5 CSV imports per minute per IP (heavy operation)
const csvImportLimiter = createLimiter(
  60 * 1000,
  5,
  'Too many import requests. Wait 1 minute.'
);

// 3 credential reveals per 10 minutes per IP
const revealLimiter = createLimiter(
  10 * 60 * 1000,
  3,
  'Too many reveal attempts. Try again in 10 minutes.'
);

module.exports = {
  loginLimiter,
  orderCreateLimiter,
  orderVerifyLimiter,
  csvImportLimiter,
  revealLimiter
};

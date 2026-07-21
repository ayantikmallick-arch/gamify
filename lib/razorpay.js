/* lib/razorpay.js – Razorpay SDK wrapper + HMAC signature verification */
const Razorpay = require('razorpay');
const crypto   = require('crypto');

function getInstance() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
  }
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

/**
 * Verify Razorpay payment signature (HMAC-SHA256).
 * @param {string} orderId       – razorpay_order_id from checkout
 * @param {string} paymentId     – razorpay_payment_id from checkout
 * @param {string} signature     – razorpay_signature from checkout
 * @returns {boolean}
 */
function verifySignature(orderId, paymentId, signature) {
  const body     = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  // Timing-safe comparison
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

module.exports = { getInstance, verifySignature };

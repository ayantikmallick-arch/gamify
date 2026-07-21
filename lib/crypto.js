/* lib/crypto.js – AES-256-GCM encrypt / decrypt for Steam passwords */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters in .env');
  }
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a plaintext string.
 * @returns {{ ciphertext: string, iv: string, authTag: string }} – all hex strings
 */
function encrypt(plaintext) {
  const key    = getKey();
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted    += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv:        iv.toString('hex'),
    authTag:   authTag.toString('hex')
  };
}

/**
 * Decrypt an encrypted object.
 * @param {{ ciphertext: string, iv: string, authTag: string }} obj
 * @returns {string} – plaintext
 */
function decrypt({ ciphertext, iv, authTag }) {
  const key      = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted  = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted     += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };

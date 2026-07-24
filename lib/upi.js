/* lib/upi.js – Dynamic UPI QR Code Generator */
const QRCode = require('qrcode');

function getUpiConfig() {
  return {
    upiId:   process.env.UPI_ID   || '9851228158@fam',
    upiName: process.env.UPI_NAME || 'GamifyDeals'
  };
}

function generateUpiUrl({ amount, orderId }) {
  const { upiId, upiName } = getUpiConfig();
  const amtStr = parseFloat(amount).toFixed(2);
  const note   = `Order_${orderId.substring(0, 8)}`;
  
  // Standard UPI URI Format
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amtStr}&cu=INR&tn=${encodeURIComponent(note)}`;
}

async function generateQrDataUrl(upiUrl) {
  try {
    return await QRCode.toDataURL(upiUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark:  '#0d0f14',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('[UPI] QR Generation Error:', err);
    throw err;
  }
}

module.exports = {
  getUpiConfig,
  generateUpiUrl,
  generateQrDataUrl
};

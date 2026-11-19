const crypto = require('node:crypto');

// Gitea signs the raw request body with HMAC-SHA256 using the webhook secret
// and sends the hex digest in the X-Gitea-Signature header.
function verifyGiteaSignature(rawBody, signatureHeader, secret) {
  if (!secret || typeof signatureHeader !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let received;
  try {
    received = Buffer.from(signatureHeader.trim(), 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

module.exports = { verifyGiteaSignature };

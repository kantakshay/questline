const crypto = require('node:crypto');

const SESSION_COOKIE = 'ql_session';
const OAUTH_COOKIE = 'ql_oauth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_TTL_MS = 10 * 60 * 1000; // the Gitea round trip must finish within 10 minutes

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

// Session cookie value is random; the database only ever sees its hash.
function hashToken(token) {
  return sha256(token).toString('hex');
}

function newSessionToken() {
  const token = randomToken();
  return { token, idHash: hashToken(token) };
}

// PKCE (RFC 7636): we keep the verifier, Gitea only sees its SHA-256 "challenge".
// An attacker who intercepts the authorization code can't redeem it without the verifier.
function createPkcePair() {
  const verifier = randomToken();
  return { verifier, challenge: sha256(verifier).toString('base64url') };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Minimal Cookie header parser: "a=1; b=2" -> { a: '1', b: '2' }.
function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed percent-encoding instead of failing the request.
    }
  }
  return cookies;
}

module.exports = {
  SESSION_COOKIE,
  OAUTH_COOKIE,
  SESSION_TTL_MS,
  OAUTH_TTL_MS,
  randomToken,
  hashToken,
  newSessionToken,
  createPkcePair,
  safeEqual,
  parseCookies,
};

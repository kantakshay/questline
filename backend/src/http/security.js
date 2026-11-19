const { SESSION_COOKIE, hashToken, parseCookies } = require('../auth/tokens');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CORS: only the Questline frontend may call the API from a browser, with cookies.
// Any other site's JavaScript gets no Access-Control-Allow-Origin header, so the browser
// refuses to hand it the response.
function cors(allowedOrigin) {
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    const allowed = origin === allowedOrigin;
    if (allowed) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '600');
      }
      return res.status(204).end();
    }
    return next();
  };
}

// CSRF defence: a request that changes something must come from the Questline frontend.
// Browsers always send Origin on cross-site requests and can't let a page fake it.
// (SameSite=Lax cookies are the first layer; this covers sibling subdomains too.)
function requireSameOrigin(allowedOrigin) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get('Origin') !== allowedOrigin) {
      return res.status(403).json({ error: 'cross-origin request blocked' });
    }
    return next();
  };
}

// Looks up the session cookie and sets req.user (or null). Never rejects by itself.
function loadSession(userStore) {
  return async (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      req.sessionIdHash = hashToken(token);
      req.user = await userStore.findSessionUser(req.sessionIdHash);
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  return next();
}

module.exports = { cors, requireSameOrigin, loadSession, requireAuth };

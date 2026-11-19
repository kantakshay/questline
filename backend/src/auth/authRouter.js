const express = require('express');
const {
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
} = require('./tokens');
const { requireSameOrigin } = require('../http/security');

// Sign in with Gitea (OAuth2 authorization code flow + PKCE + state).
//
//   browser ──GET /auth/gitea/login──▶ us ──302──▶ Gitea "Authorize Questline?"
//   browser ◀──302 /auth/gitea/callback?code&state── Gitea
//   us ──code + verifier──▶ Gitea (server to server) ──▶ access token ──▶ userinfo
//   us: upsert user, create session, set cookie, 302 back to the frontend
function createAuthRouter({ config, userStore, giteaOAuth, logger = console }) {
  const router = express.Router();

  const cookieBase = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure };
  const oauthCookie = { ...cookieBase, path: '/auth/gitea' };
  const sessionCookie = { ...cookieBase, path: '/' };

  const backToFrontend = (res, loginError) =>
    res.redirect(
      302,
      loginError ? `${config.frontendUrl}/?login_error=${loginError}` : `${config.frontendUrl}/`,
    );

  router.get('/gitea/login', (req, res) => {
    if (!giteaOAuth.isConfigured) {
      return res.status(503).json({ error: 'Gitea sign-in is not configured' });
    }
    const state = randomToken(16);
    const { verifier, challenge } = createPkcePair();
    // Remember state + verifier in a short-lived cookie only this browser holds.
    res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, { ...oauthCookie, maxAge: OAUTH_TTL_MS });
    return res.redirect(302, giteaOAuth.authorizeUrl({ state, codeChallenge: challenge }));
  });

  router.get('/gitea/callback', async (req, res) => {
    const saved = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, oauthCookie); // single use, whatever happens next

    if (req.query.error) return backToFrontend(res, 'denied');

    const { code, state } = req.query;
    const [savedState, verifier] = typeof saved === 'string' ? saved.split('.') : [];
    if (typeof code !== 'string' || typeof state !== 'string' || !savedState || !verifier) {
      return backToFrontend(res, 'state');
    }
    // Must match what *this* browser was given, or someone is replaying a login link at us.
    if (!safeEqual(savedState, state)) return backToFrontend(res, 'state');

    try {
      const accessToken = await giteaOAuth.exchangeCode({ code, codeVerifier: verifier });
      const profile = await giteaOAuth.fetchUser(accessToken);
      const isAdmin =
        Boolean(config.giteaAdminLogin) &&
        profile.login.toLowerCase() === config.giteaAdminLogin.toLowerCase();

      const user = await userStore.upsertGiteaUser({
        ...profile,
        email: profile.email ?? `${profile.login.toLowerCase()}@users.noreply.questline.io`,
        isAdmin,
      });

      // Fresh session on every sign-in (prevents session fixation); drop any old one.
      const previous = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (previous) await userStore.deleteSession(hashToken(previous));
      const { token, idHash } = newSessionToken();
      await userStore.createSession({
        idHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: req.get('User-Agent')?.slice(0, 300) ?? null,
      });

      res.cookie(SESSION_COOKIE, token, { ...sessionCookie, maxAge: SESSION_TTL_MS });
      return backToFrontend(res);
    } catch (err) {
      logger.error('Gitea sign-in failed:', err);
      return backToFrontend(res, 'server');
    }
  });

  router.post('/logout', requireSameOrigin(config.frontendUrl), async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await userStore.deleteSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, sessionCookie);
    return res.status(204).end();
  });

  return router;
}

module.exports = { createAuthRouter };

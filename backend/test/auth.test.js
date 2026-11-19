const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { hashToken } = require('../src/auth/tokens');

const FRONTEND = 'http://localhost:5173';
const silentLogger = { error() {}, warn() {}, log() {} };

// In-memory stand-in for src/db/userStore.js.
function createFakeUserStore() {
  const users = [];
  const sessions = new Map(); // idHash -> { userId, expiresAt }
  return {
    users,
    sessions,
    async upsertGiteaUser({ giteaUserId, login, email, displayName, isAdmin }) {
      let u = users.find((x) => x.gitea_user_id === giteaUserId);
      if (!u) {
        u = { id: users.length + 1, gitea_user_id: giteaUserId, experience_level: isAdmin ? 'senior' : null };
        users.push(u);
      }
      Object.assign(u, {
        username: login,
        gitea_login: login,
        email,
        display_name: displayName,
        role: isAdmin ? 'admin' : 'student',
      });
      return { ...u };
    },
    async createSession({ idHash, userId, expiresAt }) {
      sessions.set(idHash, { userId, expiresAt });
    },
    async findSessionUser(idHash) {
      const s = sessions.get(idHash);
      if (!s || s.expiresAt <= new Date()) return null;
      return { ...users.find((u) => u.id === s.userId) };
    },
    async deleteSession(idHash) {
      sessions.delete(idHash);
    },
    async setExperienceLevelIfUnset(userId, level) {
      const u = users.find((x) => x.id === userId);
      if (!u || u.experience_level) return null;
      u.experience_level = level;
      return { ...u };
    },
  };
}

function createFakeGiteaOAuth(profile = {}) {
  const calls = { exchange: [] };
  return {
    calls,
    isConfigured: true,
    failExchange: false,
    authorizeUrl: ({ state, codeChallenge }) =>
      `http://gitea.test/login/oauth/authorize?state=${state}&code_challenge=${codeChallenge}`,
    async exchangeCode(args) {
      calls.exchange.push(args);
      if (this.failExchange) throw new Error('gitea said no');
      return 'access-token';
    },
    async fetchUser() {
      return { giteaUserId: 42, login: 'ravi', email: 'ravi@example.com', displayName: 'Ravi', ...profile };
    },
  };
}

async function startServer({ userStore = createFakeUserStore(), giteaOAuth = createFakeGiteaOAuth() } = {}) {
  const app = createApp({
    config: {
      giteaWebhookSecret: 'x',
      giteaAdminLogin: 'kant_akshay',
      frontendUrl: FRONTEND,
      cookieSecure: false,
    },
    withTransaction: async () => {},
    makeStore: () => ({}),
    userStore,
    giteaOAuth,
    logger: silentLogger,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, userStore, giteaOAuth };
}

const cookieValue = (setCookies, name) => {
  const line = setCookies.find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0].slice(name.length + 1) : undefined;
};

// Runs /auth/gitea/login, then the callback, like a browser would. Returns the session token.
async function signIn(base, { cookie = '' } = {}) {
  const login = await fetch(`${base}/auth/gitea/login`, { redirect: 'manual' });
  const oauth = cookieValue(login.headers.getSetCookie(), 'ql_oauth');
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const callback = await fetch(`${base}/auth/gitea/callback?code=abc&state=${state}`, {
    redirect: 'manual',
    headers: { Cookie: [`ql_oauth=${oauth}`, cookie].filter(Boolean).join('; ') },
  });
  return { callback, session: cookieValue(callback.headers.getSetCookie(), 'ql_session') };
}

const authed = (session, extra = {}) => ({ headers: { Cookie: `ql_session=${session}`, ...extra } });

// ---------- Sign-in flow ----------

test('login redirects to Gitea with state and a PKCE challenge, and sets a short-lived oauth cookie', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${base}/auth/gitea/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, 'http://gitea.test');
  const state = location.searchParams.get('state');
  assert.ok(state && location.searchParams.get('code_challenge'));

  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('ql_oauth='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/auth\/gitea/);
  assert.ok(cookie.startsWith(`ql_oauth=${state}.`), 'cookie stores the same state');
});

test('login returns 503 when the Gitea OAuth app is not configured', async (t) => {
  const giteaOAuth = createFakeGiteaOAuth();
  giteaOAuth.isConfigured = false;
  const { server, base } = await startServer({ giteaOAuth });
  t.after(() => server.close());
  const res = await fetch(`${base}/auth/gitea/login`, { redirect: 'manual' });
  assert.equal(res.status, 503);
});

test('a successful callback creates the user, sets an HttpOnly session cookie and returns to the frontend', async (t) => {
  const { server, base, userStore, giteaOAuth } = await startServer();
  t.after(() => server.close());

  const { callback, session } = await signIn(base);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `${FRONTEND}/`);
  assert.ok(session);
  const cookie = callback.headers.getSetCookie().find((c) => c.startsWith('ql_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  assert.equal(userStore.users.length, 1);
  assert.equal(userStore.users[0].role, 'student');
  assert.equal(userStore.users[0].experience_level, null);
  // The database only stores the hash of the cookie token, never the token itself.
  assert.ok(userStore.sessions.has(hashToken(session)));
  assert.ok(![...userStore.sessions.keys()].includes(session));
  // The PKCE verifier from the cookie was sent with the code exchange.
  assert.ok(giteaOAuth.calls.exchange[0].codeVerifier);
});

test('signing in again reuses the same user and replaces the old session', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());

  const first = await signIn(base);
  const second = await signIn(base, { cookie: `ql_session=${first.session}` });
  assert.equal(userStore.users.length, 1);
  assert.notEqual(first.session, second.session);
  assert.ok(!userStore.sessions.has(hashToken(first.session)), 'old session removed');
});

test('the configured admin login gets the admin role (case-insensitive)', async (t) => {
  const { server, base, userStore } = await startServer({
    giteaOAuth: createFakeGiteaOAuth({ giteaUserId: 1, login: 'Kant_Akshay' }),
  });
  t.after(() => server.close());
  await signIn(base);
  assert.equal(userStore.users[0].role, 'admin');
});

test('a Gitea account without an email gets a placeholder address', async (t) => {
  const { server, base, userStore } = await startServer({
    giteaOAuth: createFakeGiteaOAuth({ email: null }),
  });
  t.after(() => server.close());
  await signIn(base);
  assert.equal(userStore.users[0].email, 'ravi@users.noreply.questline.io');
});

test('callback without the oauth cookie is rejected (no session)', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());
  const res = await fetch(`${base}/auth/gitea/callback?code=abc&state=xyz`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), `${FRONTEND}/?login_error=state`);
  assert.equal(cookieValue(res.headers.getSetCookie(), 'ql_session'), undefined);
  assert.equal(userStore.users.length, 0);
});

test('callback with a state that does not match the cookie is rejected', async (t) => {
  const { server, base, giteaOAuth } = await startServer();
  t.after(() => server.close());
  const login = await fetch(`${base}/auth/gitea/login`, { redirect: 'manual' });
  const oauth = cookieValue(login.headers.getSetCookie(), 'ql_oauth');
  const res = await fetch(`${base}/auth/gitea/callback?code=abc&state=attacker-state`, {
    redirect: 'manual',
    headers: { Cookie: `ql_oauth=${oauth}` },
  });
  assert.equal(res.headers.get('location'), `${FRONTEND}/?login_error=state`);
  assert.equal(giteaOAuth.calls.exchange.length, 0, 'code is never exchanged');
});

test('callback without a code is rejected', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const login = await fetch(`${base}/auth/gitea/login`, { redirect: 'manual' });
  const oauth = cookieValue(login.headers.getSetCookie(), 'ql_oauth');
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const res = await fetch(`${base}/auth/gitea/callback?state=${state}`, {
    redirect: 'manual',
    headers: { Cookie: `ql_oauth=${oauth}` },
  });
  assert.equal(res.headers.get('location'), `${FRONTEND}/?login_error=state`);
});

test('a student who clicks "Cancel" on Gitea is sent back with login_error=denied', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const res = await fetch(`${base}/auth/gitea/callback?error=access_denied&state=x`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), `${FRONTEND}/?login_error=denied`);
});

test('a Gitea failure during code exchange ends with login_error=server and no session', async (t) => {
  const giteaOAuth = createFakeGiteaOAuth();
  giteaOAuth.failExchange = true;
  const { server, base, userStore } = await startServer({ giteaOAuth });
  t.after(() => server.close());
  const { callback, session } = await signIn(base);
  assert.equal(callback.headers.get('location'), `${FRONTEND}/?login_error=server`);
  assert.equal(session, undefined);
  assert.equal(userStore.sessions.size, 0);
});

test('the oauth cookie is cleared after the callback so it cannot be reused', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const { callback } = await signIn(base);
  const cleared = callback.headers.getSetCookie().find((c) => c.startsWith('ql_oauth='));
  assert.match(cleared, /ql_oauth=;/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
});

// ---------- /api/me ----------

test('GET /api/me returns the signed-in user and says onboarding is needed', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);
  const res = await fetch(`${base}/api/me`, authed(session));
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.username, 'ravi');
  assert.equal(user.needsOnboarding, true);
  assert.equal(user.experienceLevel, null);
  assert.equal(user.gitea_user_id, undefined, 'no internal columns leak');
});

test('GET /api/me is 401 without a cookie, with a made-up cookie, and with an expired session', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/me`, authed('made-up-token'))).status, 401);

  const { session } = await signIn(base);
  userStore.sessions.get(hashToken(session)).expiresAt = new Date(Date.now() - 1000);
  assert.equal((await fetch(`${base}/api/me`, authed(session))).status, 401);
});

// ---------- Onboarding ----------

const patchMe = (base, session, body, origin = FRONTEND) =>
  fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { Cookie: `ql_session=${session}`, 'Content-Type': 'application/json', Origin: origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('a new student can choose their experience level once', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);

  const res = await patchMe(base, session, { experienceLevel: 'junior' });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.experienceLevel, 'junior');
  assert.equal(user.needsOnboarding, false);
});

test('a junior cannot later promote themselves to senior', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);
  await patchMe(base, session, { experienceLevel: 'junior' });
  const res = await patchMe(base, session, { experienceLevel: 'senior' });
  assert.equal(res.status, 409);
});

test('invalid experience levels and broken JSON are rejected with 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);
  assert.equal((await patchMe(base, session, { experienceLevel: 'admin' })).status, 400);
  assert.equal((await patchMe(base, session, {})).status, 400);
  const broken = await patchMe(base, session, '{"experienceLevel":');
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: 'bad request' });
});

test('onboarding requires sign-in', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal((await patchMe(base, 'nope', { experienceLevel: 'junior' })).status, 401);
});

test('changes from another origin are blocked (CSRF), even with a valid session', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);
  const res = await patchMe(base, session, { experienceLevel: 'senior' }, 'https://evil.example');
  assert.equal(res.status, 403);
  assert.equal(userStore.users[0].experience_level, null);

  const noOrigin = await fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { Cookie: `ql_session=${session}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ experienceLevel: 'senior' }),
  });
  assert.equal(noOrigin.status, 403);
});

// ---------- Logout ----------

test('logout deletes the session and clears the cookie', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);

  const res = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    ...authed(session, { Origin: FRONTEND }),
  });
  assert.equal(res.status, 204);
  assert.match(
    res.headers.getSetCookie().find((c) => c.startsWith('ql_session=')),
    /Expires=Thu, 01 Jan 1970/,
  );
  assert.equal(userStore.sessions.size, 0);
  assert.equal((await fetch(`${base}/api/me`, authed(session))).status, 401);
});

test('logout from another origin is blocked and the session survives', async (t) => {
  const { server, base, userStore } = await startServer();
  t.after(() => server.close());
  const { session } = await signIn(base);
  const res = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    ...authed(session, { Origin: 'https://evil.example' }),
  });
  assert.equal(res.status, 403);
  assert.equal(userStore.sessions.size, 1);
});

// ---------- CORS ----------

test('CORS allows the Questline frontend with credentials', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const preflight = await fetch(`${base}/api/me`, {
    method: 'OPTIONS',
    headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'PATCH' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
});

test('CORS gives other origins nothing, so browsers block them', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const preflight = await fetch(`${base}/api/me`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PATCH' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  const get = await fetch(`${base}/api/me`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
});

test('the webhook route does not get CORS headers', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const res = await fetch(`${base}/webhooks/gitea`, { method: 'POST', headers: { Origin: FRONTEND } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

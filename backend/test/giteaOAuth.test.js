const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGiteaOAuth } = require('../src/auth/giteaOAuth');
const { createPkcePair, parseCookies, safeEqual, hashToken, newSessionToken } = require('../src/auth/tokens');

const settings = {
  baseUrl: 'http://gitea.test/',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  redirectUri: 'http://localhost:4000/auth/gitea/callback',
};

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const r = responses.shift();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { impl, calls };
}

test('authorizeUrl points at Gitea with every OAuth + PKCE parameter', () => {
  const url = new URL(createGiteaOAuth(settings).authorizeUrl({ state: 's1', codeChallenge: 'c1' }));
  assert.equal(url.origin + url.pathname, 'http://gitea.test/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), settings.redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('code_challenge'), 'c1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('isConfigured is false when the client id or secret is missing', () => {
  assert.equal(createGiteaOAuth(settings).isConfigured, true);
  assert.equal(createGiteaOAuth({ ...settings, clientSecret: '' }).isConfigured, false);
  assert.equal(createGiteaOAuth({ ...settings, clientId: '' }).isConfigured, false);
});

test('exchangeCode sends the code, verifier and client credentials and returns the token', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'tok' } }]);
  const token = await createGiteaOAuth({ ...settings, fetchImpl: impl }).exchangeCode({
    code: 'code-1',
    codeVerifier: 'ver-1',
  });
  assert.equal(token, 'tok');
  assert.equal(calls[0].url, 'http://gitea.test/login/oauth/access_token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    client_id: 'client-1',
    client_secret: 'secret-1',
    code: 'code-1',
    grant_type: 'authorization_code',
    redirect_uri: settings.redirectUri,
    code_verifier: 'ver-1',
  });
});

test('exchangeCode throws on an HTTP error or a response without a token', async () => {
  const bad = fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
  await assert.rejects(
    createGiteaOAuth({ ...settings, fetchImpl: bad.impl }).exchangeCode({ code: 'x' }),
    /400/,
  );
  const empty = fakeFetch([{ status: 200, body: {} }]);
  await assert.rejects(
    createGiteaOAuth({ ...settings, fetchImpl: empty.impl }).exchangeCode({ code: 'x' }),
    /no access_token/,
  );
});

test('fetchUser maps Gitea userinfo and sends the bearer token', async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: { sub: '7', preferred_username: 'ravi', email: 'r@x.io', name: 'Ravi K' } },
  ]);
  const user = await createGiteaOAuth({ ...settings, fetchImpl: impl }).fetchUser('tok');
  assert.deepEqual(user, { giteaUserId: 7, login: 'ravi', email: 'r@x.io', displayName: 'Ravi K' });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
});

test('fetchUser rejects incomplete or malformed userinfo', async () => {
  for (const body of [
    { preferred_username: 'ravi' },
    { sub: '7' },
    { sub: 'abc', preferred_username: 'r' },
  ]) {
    const { impl } = fakeFetch([{ status: 200, body }]);
    await assert.rejects(createGiteaOAuth({ ...settings, fetchImpl: impl }).fetchUser('tok'));
  }
  const { impl } = fakeFetch([{ status: 401, body: {} }]);
  await assert.rejects(createGiteaOAuth({ ...settings, fetchImpl: impl }).fetchUser('tok'), /401/);
});

test('PKCE challenge is the base64url SHA-256 of the verifier, and pairs are unique', () => {
  const a = createPkcePair();
  const b = createPkcePair();
  assert.equal(a.challenge, crypto.createHash('sha256').update(a.verifier).digest('base64url'));
  assert.notEqual(a.verifier, b.verifier);
  assert.ok(a.verifier.length >= 43, 'RFC 7636 requires at least 43 characters');
});

test('session tokens are random and stored only as their hash', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.idHash, hashToken(a.token));
  assert.notEqual(a.idHash, a.token);
});

test('parseCookies handles normal, empty, duplicate and malformed input', () => {
  assert.deepEqual(parseCookies('a=1; b=two'), { a: '1', b: 'two' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('a=1; a=2'), { a: '1' }, 'first value wins');
  assert.deepEqual(parseCookies('bad; c=%E0%A4%A'), {}, 'malformed parts are ignored');
});

test('safeEqual compares exactly', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

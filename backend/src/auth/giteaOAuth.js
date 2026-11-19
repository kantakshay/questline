// Talks to Gitea's built-in OAuth2 / OpenID Connect provider.
// Docs: https://docs.gitea.com/development/oauth2-provider

function createGiteaOAuth({ baseUrl, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    isConfigured: Boolean(clientId && clientSecret && redirectUri),

    // Where we send the browser so the student can approve "Sign in to Questline".
    authorizeUrl({ state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return `${base}/login/oauth/authorize?${params}`;
    },

    // Server-to-server: trade the one-time code (+ PKCE verifier) for an access token.
    async exchangeCode({ code, codeVerifier }) {
      const res = await fetchImpl(`${base}/login/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(`Gitea token exchange failed with HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.access_token !== 'string' || !data.access_token) {
        throw new Error('Gitea token response had no access_token');
      }
      return data.access_token;
    },

    // Who just signed in, from the OpenID Connect userinfo endpoint.
    async fetchUser(accessToken) {
      const res = await fetchImpl(`${base}/login/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Gitea userinfo failed with HTTP ${res.status}`);
      const info = await res.json();
      const giteaUserId = Number(info.sub);
      if (!Number.isSafeInteger(giteaUserId) || giteaUserId <= 0 || !info.preferred_username) {
        throw new Error('Gitea userinfo response is missing sub or preferred_username');
      }
      return {
        giteaUserId,
        login: info.preferred_username,
        email: info.email || null,
        displayName: info.name || info.preferred_username,
      };
    },
  };
}

module.exports = { createGiteaOAuth };

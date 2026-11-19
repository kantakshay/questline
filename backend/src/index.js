const config = require('./config');
const { pool, withTransaction } = require('./db/pool');
const { makeStore } = require('./db/store');
const { makeUserStore } = require('./db/userStore');
const { createGiteaOAuth } = require('./auth/giteaOAuth');
const { createApp } = require('./app');

const giteaOAuth = createGiteaOAuth({
  baseUrl: config.giteaBaseUrl,
  clientId: config.giteaOAuthClientId,
  clientSecret: config.giteaOAuthClientSecret,
  redirectUri: config.giteaOAuthRedirectUrl,
});
if (!giteaOAuth.isConfigured) {
  console.warn(
    'Sign in with Gitea is not configured: set GITEA_OAUTH_CLIENT_ID and GITEA_OAUTH_CLIENT_SECRET',
  );
}

const app = createApp({
  config,
  withTransaction,
  makeStore,
  userStore: makeUserStore(pool),
  giteaOAuth,
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

const express = require('express');
const { createGiteaWebhookRouter } = require('./webhooks/giteaRouter');
const { createAuthRouter } = require('./auth/authRouter');
const { createApiRouter } = require('./api/apiRouter');
const { cors } = require('./http/security');

// Dependencies are injected so tests can run the app without Postgres or Gitea.
function createApp({ config, withTransaction, makeStore, userStore, giteaOAuth, logger = console }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Mounted before any JSON parser: signature checks need the raw body.
  // No CORS here: Gitea is a server, not a browser.
  app.use(
    '/webhooks/gitea',
    createGiteaWebhookRouter({
      secret: config.giteaWebhookSecret,
      adminLogin: config.giteaAdminLogin,
      withTransaction,
      makeStore,
      logger,
    }),
  );

  // Browser-facing routes: CORS for the Questline frontend only.
  app.use('/auth', cors(config.frontendUrl), createAuthRouter({ config, userStore, giteaOAuth, logger }));
  app.use('/api', cors(config.frontendUrl), createApiRouter({ config, userStore }));

  // JSON errors instead of Express's HTML page; no stack traces or internals to the client.
  app.use((err, req, res, _next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) logger.error('Unhandled error:', err);
    res.status(status).json({ error: status === 500 ? 'internal server error' : 'bad request' });
  });

  return app;
}

module.exports = { createApp };

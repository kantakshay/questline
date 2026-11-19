require('dotenv').config({ quiet: true });

const trimSlash = (url) => url.replace(/\/+$/, '');

const config = {
  port: Number(process.env.PORT) || 4000,

  databaseUrl: process.env.DATABASE_URL || 'postgres://questline:questline@localhost:5432/questline',
  // Neon: put sslmode=verify-full in DATABASE_URL (it overrides these two settings).
  // Hosts needing a custom CA (e.g. Aurora + RDS bundle): DATABASE_SSL=true + DATABASE_SSL_CA.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databaseSslCa: process.env.DATABASE_SSL_CA || null,

  giteaBaseUrl: trimSlash(process.env.GITEA_BASE_URL || 'http://localhost:3001'),
  giteaWebhookSecret: process.env.GITEA_WEBHOOK_SECRET || '',
  // Gitea login of the final approver. They get the admin role on sign-in,
  // and merges by anyone else are logged as a warning.
  giteaAdminLogin: process.env.GITEA_ADMIN_LOGIN || '',

  // Sign in with Gitea (an OAuth2 application registered in Gitea).
  giteaOAuthClientId: process.env.GITEA_OAUTH_CLIENT_ID || '',
  giteaOAuthClientSecret: process.env.GITEA_OAUTH_CLIENT_SECRET || '',
  giteaOAuthRedirectUrl: process.env.GITEA_OAUTH_REDIRECT_URL || 'http://localhost:4000/auth/gitea/callback',

  // The only browser origin allowed to call the API with cookies (CORS + CSRF origin check).
  frontendUrl: trimSlash(process.env.FRONTEND_URL || 'http://localhost:5173'),
  // Secure cookies need HTTPS; on by default in production, off for http://localhost.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
};

module.exports = config;

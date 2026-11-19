-- Sign in with Gitea (OAuth2) + server-side sessions.
--
-- Users are created on their first Gitea sign-in, before they have chosen junior/senior,
-- so experience_level may be NULL until onboarding. (The CHECK constraint already allows NULL.)
-- users.password_hash stays in place for a future branded Questline sign-up (see ARCHITECTURE.md).
ALTER TABLE users ALTER COLUMN experience_level DROP NOT NULL;

-- One row per signed-in browser. The cookie holds a random token; only its SHA-256 hash is
-- stored, so a leaked database dump can't be replayed as live sessions.
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

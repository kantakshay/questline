// Users and sessions. `db` is anything with pg's query(): the pool or a client.

const USER_COLUMNS = 'id, username, display_name, email, role, experience_level, gitea_login';
const SESSION_USER_COLUMNS =
  'u.id, u.username, u.display_name, u.email, u.role, u.experience_level, u.gitea_login';

function makeUserStore(db) {
  return {
    // Creates the user on first Gitea sign-in, or refreshes their details on later ones
    // (Gitea usernames and emails can change). The role is re-derived every time, so changing
    // GITEA_ADMIN_LOGIN moves admin rights instead of leaving a stale admin behind.
    async upsertGiteaUser({ giteaUserId, login, email, displayName, isAdmin }) {
      const { rows } = await db.query(
        `INSERT INTO users (email, username, display_name, gitea_user_id, gitea_login, role, experience_level)
         VALUES ($1, $2, $3, $4, $2,
                 CASE WHEN $5::boolean THEN 'admin' ELSE 'student' END,
                 CASE WHEN $5::boolean THEN 'senior' END)
         ON CONFLICT (gitea_user_id) DO UPDATE SET
           email            = EXCLUDED.email,
           username         = EXCLUDED.username,
           display_name     = EXCLUDED.display_name,
           gitea_login      = EXCLUDED.gitea_login,
           role             = EXCLUDED.role,
           experience_level = COALESCE(users.experience_level, EXCLUDED.experience_level),
           updated_at       = now()
         RETURNING ${USER_COLUMNS}`,
        [email, login, displayName, giteaUserId, isAdmin],
      );
      return rows[0];
    },

    async createSession({ idHash, userId, expiresAt, userAgent }) {
      await db.query(
        'INSERT INTO sessions (id_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)',
        [idHash, userId, expiresAt, userAgent],
      );
    },

    // Returns the signed-in user, or null for unknown or expired sessions.
    async findSessionUser(idHash) {
      const { rows } = await db.query(
        `SELECT ${SESSION_USER_COLUMNS}
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = $1 AND s.expires_at > now()`,
        [idHash],
      );
      return rows[0] ?? null;
    },

    async deleteSession(idHash) {
      await db.query('DELETE FROM sessions WHERE id_hash = $1', [idHash]);
    },

    // Experience level is chosen once at onboarding. Returns null if it was already set,
    // so a junior can't quietly promote themselves to senior (seniors review others' code).
    async setExperienceLevelIfUnset(userId, level) {
      const { rows } = await db.query(
        `UPDATE users SET experience_level = $2, updated_at = now()
         WHERE id = $1 AND experience_level IS NULL
         RETURNING ${USER_COLUMNS}`,
        [userId, level],
      );
      return rows[0] ?? null;
    },
  };
}

module.exports = { makeUserStore };

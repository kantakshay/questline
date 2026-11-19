const express = require('express');
const { requireSameOrigin, loadSession, requireAuth } = require('../http/security');

const EXPERIENCE_LEVELS = new Set(['junior', 'senior']);

// Shape sent to the browser. Only fields the frontend needs; never internal columns.
function toPublicUser(u) {
  return {
    id: String(u.id),
    username: u.username,
    displayName: u.display_name,
    email: u.email,
    role: u.role,
    experienceLevel: u.experience_level,
    giteaLogin: u.gitea_login,
    needsOnboarding: !u.experience_level,
  };
}

function createApiRouter({ config, userStore }) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));
  router.use(requireSameOrigin(config.frontendUrl));
  router.use(loadSession(userStore));

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  });

  // Onboarding: pick junior or senior, once.
  router.patch('/me', requireAuth, async (req, res) => {
    const level = req.body?.experienceLevel;
    if (!EXPERIENCE_LEVELS.has(level)) {
      return res.status(400).json({ error: 'experienceLevel must be "junior" or "senior"' });
    }
    const updated = await userStore.setExperienceLevelIfUnset(req.user.id, level);
    if (!updated) {
      return res.status(409).json({ error: 'experience level is already set; ask an admin to change it' });
    }
    return res.json({ user: toPublicUser(updated) });
  });

  return router;
}

module.exports = { createApiRouter, toPublicUser };

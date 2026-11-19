const express = require('express');
const { verifyGiteaSignature } = require('./verifySignature');
const { dispatchGiteaEvent } = require('./giteaHandlers');

// POST /webhooks/gitea
// Verifies the signature against the raw body, drops redeliveries, then applies
// the event inside one transaction. If handling fails the transaction (including
// the delivery record) rolls back and we return 500, so a Gitea redelivery retries it.
function createGiteaWebhookRouter({ secret, adminLogin, withTransaction, makeStore, logger = console }) {
  const router = express.Router();

  router.post('/', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    if (!secret) {
      logger.error('GITEA_WEBHOOK_SECRET is not set; rejecting webhook');
      return res.status(503).json({ error: 'webhook secret not configured' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyGiteaSignature(rawBody, req.get('X-Gitea-Signature'), secret)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const event = req.get('X-Gitea-Event');
    const deliveryId = req.get('X-Gitea-Delivery');
    if (!event || !deliveryId) {
      return res.status(400).json({ error: 'missing X-Gitea-Event or X-Gitea-Delivery header' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'body is not valid JSON' });
    }

    try {
      const result = await withTransaction(async (db) => {
        const store = makeStore(db);
        const isNew = await store.recordDelivery({
          deliveryId,
          event,
          action: payload.action,
          repoFullName: payload.repository?.full_name,
        });
        if (!isNew) return { status: 'duplicate', detail: `delivery ${deliveryId} already handled` };

        const outcome = await dispatchGiteaEvent(store, event, payload, { adminLogin, logger });
        await store.finishDelivery(deliveryId, outcome.status, outcome.detail);
        return outcome;
      });
      return res.status(200).json(result);
    } catch (err) {
      logger.error(`Gitea webhook ${deliveryId} (${event}) failed:`, err);
      return res.status(500).json({ error: 'failed to process webhook' });
    }
  });

  return router;
}

module.exports = { createGiteaWebhookRouter };

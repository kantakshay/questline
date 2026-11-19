const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { verifyGiteaSignature } = require('../src/webhooks/verifySignature');

const SECRET = 'test-secret';
const silentLogger = { error() {}, warn() {}, log() {} };

// In-memory stand-in for src/db/store.js.
function createFakeDb() {
  const state = {
    deliveries: new Map(),
    users: [{ id: 1, gitea_login: 'priya', role: 'student', experience_level: 'senior' }],
    enrollments: [
      { id: 10, quest_id: 5, user_id: 2, status: 'in_progress', repo_full_name: 'ravi/quest-todo-app' },
    ],
    prs: [],
    reviewComments: [],
    completedAssignments: [],
    finalOutcomes: [],
    failNextDispatch: false,
  };

  const makeStore = () => ({
    async recordDelivery({ deliveryId, event }) {
      if (state.failNextDispatch) {
        state.failNextDispatch = false;
        throw new Error('boom');
      }
      if (state.deliveries.has(deliveryId)) return false;
      state.deliveries.set(deliveryId, { event, status: 'received' });
      return true;
    },
    async finishDelivery(id, status) {
      state.deliveries.get(id).status = status;
    },
    async findUserByGiteaLogin(login) {
      return state.users.find((u) => u.gitea_login === login) ?? null;
    },
    async findEnrollmentByRepo(name) {
      return state.enrollments.find((e) => e.repo_full_name === name) ?? null;
    },
    async upsertPullRequest(pr) {
      let row = state.prs.find((p) => p.gitea_pr_id === pr.giteaPrId);
      if (!row) {
        row = {
          id: state.prs.length + 1,
          gitea_pr_id: pr.giteaPrId,
          state: 'open',
          review_status: 'awaiting_review',
        };
        state.prs.push(row);
      }
      Object.assign(row, { head_sha: pr.headSha, quest_id: pr.questId, title: pr.title });
      return { ...row };
    },
    async updatePullRequest(id, fields) {
      const row = state.prs.find((p) => p.id === id);
      if ('state' in fields) row.state = fields.state;
      if ('reviewStatus' in fields) row.review_status = fields.reviewStatus;
      if ('mergedByLogin' in fields) row.merged_by_login = fields.mergedByLogin;
    },
    async setEnrollmentStatus(id, status) {
      state.enrollments.find((e) => e.id === id).status = status;
    },
    async insertReviewComment(c) {
      state.reviewComments.push(c);
    },
    async completeAssignment(prId, userId) {
      state.completedAssignments.push({ prId, userId });
    },
    async recordFinalOutcome(prId, outcome, sha) {
      state.finalOutcomes.push({ prId, outcome, sha });
    },
  });

  return { state, makeStore, withTransaction: (fn) => fn({}) };
}

async function startServer(db, overrides = {}, logger = silentLogger) {
  const app = createApp({
    config: { giteaWebhookSecret: SECRET, giteaAdminLogin: 'kant_akshay', ...overrides },
    withTransaction: db.withTransaction,
    makeStore: db.makeStore,
    logger,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/webhooks/gitea` };
}

let deliveryCounter = 0;
function send(url, event, payload, { secret = SECRET, deliveryId = `d-${++deliveryCounter}` } = {}) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitea-Event': event,
      'X-Gitea-Delivery': deliveryId,
      'X-Gitea-Signature': signature,
    },
    body,
  });
}

function prPayload(action, overrides = {}) {
  return {
    action,
    number: 3,
    pull_request: {
      id: 900,
      number: 3,
      title: 'Add todo filtering',
      body: 'Mission complete?',
      html_url: 'http://localhost:3001/ravi/quest-todo-app/pulls/3',
      user: { id: 2, login: 'ravi' },
      head: { ref: 'feature', sha: 'aaa111' },
      base: { ref: 'main' },
      merged: false,
      ...overrides,
    },
    repository: { full_name: 'ravi/quest-todo-app' },
    sender: { login: 'ravi' },
  };
}

test('verifyGiteaSignature accepts the right digest and rejects anything else', () => {
  const body = Buffer.from('{"a":1}');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  assert.equal(verifyGiteaSignature(body, good, SECRET), true);
  assert.equal(verifyGiteaSignature(body, good, 'other'), false);
  assert.equal(verifyGiteaSignature(body, 'zz', SECRET), false);
  assert.equal(verifyGiteaSignature(body, undefined, SECRET), false);
  assert.equal(verifyGiteaSignature(body, good, ''), false);
});

test('rejects bad signatures and refuses to run without a secret', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const res = await send(url, 'pull_request', prPayload('opened'), { secret: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(db.state.prs.length, 0);

  const noSecret = await startServer(db, { giteaWebhookSecret: '' });
  t.after(() => noSecret.server.close());
  assert.equal((await send(noSecret.url, 'pull_request', prPayload('opened'))).status, 503);
});

test('opened PR on a quest repo enters the review queue and marks the quest in review', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  const res = await send(url, 'pull_request', prPayload('opened'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'processed');
  assert.equal(db.state.prs[0].review_status, 'awaiting_review');
  assert.equal(db.state.prs[0].quest_id, 5);
  assert.equal(db.state.enrollments[0].status, 'in_review');
});

test('a redelivered event is acknowledged but not applied twice', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'), { deliveryId: 'same' });
  const again = await send(url, 'pull_request', prPayload('opened'), { deliveryId: 'same' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).status, 'duplicate');
});

test('handler failures return 500 so Gitea can redeliver', async (t) => {
  const db = createFakeDb();
  db.state.failNextDispatch = true;
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  assert.equal((await send(url, 'pull_request', prPayload('opened'))).status, 500);
});

test('changes requested, then a new push, puts the PR back in the queue', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request_review_rejected', {
    ...prPayload('reviewed'),
    sender: { login: 'priya' },
    review: { type: 'pull_request_review_rejected', content: 'Handle the empty list case.' },
  });
  assert.equal(db.state.prs[0].review_status, 'changes_requested');
  assert.equal(db.state.enrollments[0].status, 'changes_requested');
  assert.deepEqual(db.state.completedAssignments, [{ prId: 1, userId: 1 }]);
  assert.equal(db.state.reviewComments[0].kind, 'request_changes');

  await send(url, 'pull_request', prPayload('synchronized', { head: { ref: 'feature', sha: 'bbb222' } }));
  assert.equal(db.state.prs[0].review_status, 'awaiting_review');
  assert.equal(db.state.prs[0].head_sha, 'bbb222');
  assert.equal(db.state.enrollments[0].status, 'in_review');
});

test('merge completes the quest and records the outcome for the feedback log', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request', prPayload('closed', { merged: true, merged_by: { login: 'kant_akshay' } }));
  assert.equal(db.state.prs[0].state, 'merged');
  assert.equal(db.state.prs[0].merged_by_login, 'kant_akshay');
  assert.equal(db.state.enrollments[0].status, 'merged');
  assert.deepEqual(db.state.finalOutcomes, [{ prId: 1, outcome: 'merged', sha: 'aaa111' }]);
});

test('closing without merge sends the quest back to in progress', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request', prPayload('closed'));
  assert.equal(db.state.prs[0].state, 'closed');
  assert.equal(db.state.enrollments[0].status, 'in_progress');
  assert.equal(db.state.finalOutcomes[0].outcome, 'closed_unmerged');
});

test('events without a pull request are ignored', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const res = await send(url, 'push', { ref: 'refs/heads/main', repository: { full_name: 'x/y' } });
  assert.equal((await res.json()).status, 'ignored');
});

// ---------- Negative and edge cases ----------

// Sends an already-built body so tests can control exactly what is signed.
function sendRaw(url, body, headers) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}
function sign(body, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('a body changed after signing is rejected (tampering)', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  const original = JSON.stringify(prPayload('opened'));
  const tampered = JSON.stringify(prPayload('closed', { merged: true, merged_by: { login: 'ravi' } }));
  const res = await sendRaw(url, tampered, {
    'X-Gitea-Event': 'pull_request',
    'X-Gitea-Delivery': 'tamper-1',
    'X-Gitea-Signature': sign(original),
  });
  assert.equal(res.status, 401);
  assert.equal(db.state.prs.length, 0);
  assert.equal(db.state.deliveries.size, 0);
});

test('a missing signature header is rejected', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const res = await sendRaw(url, JSON.stringify(prPayload('opened')), {
    'X-Gitea-Event': 'pull_request',
    'X-Gitea-Delivery': 'nosig-1',
  });
  assert.equal(res.status, 401);
});

test('missing event or delivery headers return 400 even with a valid signature', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const body = JSON.stringify(prPayload('opened'));

  const noEvent = await sendRaw(url, body, { 'X-Gitea-Delivery': 'h-1', 'X-Gitea-Signature': sign(body) });
  assert.equal(noEvent.status, 400);
  const noDelivery = await sendRaw(url, body, {
    'X-Gitea-Event': 'pull_request',
    'X-Gitea-Signature': sign(body),
  });
  assert.equal(noDelivery.status, 400);
  assert.equal(db.state.prs.length, 0);
});

test('a correctly signed body that is not JSON returns 400', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const body = 'not json {';
  const res = await sendRaw(url, body, {
    'X-Gitea-Event': 'pull_request',
    'X-Gitea-Delivery': 'bad-json-1',
    'X-Gitea-Signature': sign(body),
  });
  assert.equal(res.status, 400);
  assert.equal(db.state.deliveries.size, 0);
});

test('unhandled pull_request actions are ignored without changing state', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  const res = await send(url, 'pull_request', prPayload('label_updated'));
  assert.equal((await res.json()).status, 'ignored');
  assert.equal(db.state.prs[0].state, 'open');
  assert.equal(db.state.enrollments[0].status, 'in_review');
});

test('unknown review types are ignored and store no comment', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());
  const res = await send(url, 'pull_request_review_request', {
    ...prPayload('review_requested'),
    review: { type: 'something_new', content: '' },
  });
  assert.equal((await res.json()).status, 'ignored');
  assert.equal(db.state.reviewComments.length, 0);
});

test('a merge by someone other than the admin is still recorded but logs a warning', async (t) => {
  const warnings = [];
  const db = createFakeDb();
  const { server, url } = await startServer(db, {}, { ...silentLogger, warn: (m) => warnings.push(m) });
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request', prPayload('closed', { merged: true, merged_by: { login: 'ravi' } }));
  assert.equal(db.state.prs[0].state, 'merged');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /merged by ravi, not the admin/);
});

test('a merge by the admin logs no warning (login match is case-insensitive)', async (t) => {
  const warnings = [];
  const db = createFakeDb();
  const { server, url } = await startServer(db, {}, { ...silentLogger, warn: (m) => warnings.push(m) });
  t.after(() => server.close());
  await send(url, 'pull_request', prPayload('closed', { merged: true, merged_by: { login: 'Kant_Akshay' } }));
  assert.equal(warnings.length, 0);
});

test('a new push does not reset an approved PR back to awaiting review', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request_review_approved', {
    ...prPayload('reviewed'),
    sender: { login: 'priya' },
    review: { type: 'pull_request_review_approved', content: 'LGTM' },
  });
  await send(url, 'pull_request', prPayload('synchronized', { head: { ref: 'feature', sha: 'ccc333' } }));
  assert.equal(db.state.prs[0].review_status, 'approved');
});

test('a review on an already merged PR is stored but does not change its status', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('closed', { merged: true, merged_by: { login: 'kant_akshay' } }));
  await send(url, 'pull_request_review_rejected', {
    ...prPayload('reviewed'),
    sender: { login: 'priya' },
    review: { type: 'pull_request_review_rejected', content: 'Late feedback' },
  });
  assert.equal(db.state.reviewComments.length, 1);
  assert.equal(db.state.prs[0].state, 'merged');
  assert.equal(db.state.prs[0].review_status, 'awaiting_review');
  assert.equal(db.state.enrollments[0].status, 'merged');
});

test('a review from a Gitea user with no Questline account completes no assignment', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  await send(url, 'pull_request', prPayload('opened'));
  await send(url, 'pull_request_review_comment', {
    ...prPayload('reviewed'),
    sender: { login: 'stranger' },
    review: { type: 'pull_request_review_comment', content: 'Nice' },
  });
  assert.equal(db.state.reviewComments[0].authorUserId, null);
  assert.equal(db.state.reviewComments[0].authorLogin, 'stranger');
  assert.equal(db.state.completedAssignments.length, 0);
  assert.equal(db.state.prs[0].review_status, 'in_review');
});

test('a PR in a non-quest repo is tracked without a quest and touches no enrollment', async (t) => {
  const db = createFakeDb();
  const { server, url } = await startServer(db);
  t.after(() => server.close());

  const payload = prPayload('opened');
  payload.repository.full_name = 'kant_akshay/test-repo';
  await send(url, 'pull_request', payload);
  assert.equal(db.state.prs[0].quest_id, null);
  assert.equal(db.state.enrollments[0].status, 'in_progress');
});

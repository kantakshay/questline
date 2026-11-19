const test = require('node:test');
const assert = require('node:assert/strict');
const { makeStore } = require('../src/db/store');

// Fake pg client that records every query instead of running it.
function recordingDb(result = { rows: [], rowCount: 0 }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return result;
    },
  };
}

test('updatePullRequest only writes whitelisted columns, passing values as parameters', async () => {
  const db = recordingDb();
  const hostile = "x'; DROP TABLE users; --";
  await makeStore(db).updatePullRequest(7, { state: 'merged', mergedByLogin: hostile });

  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /SET state = \$2, merged_by_login = \$3, updated_at = now\(\) WHERE id = \$1/);
  assert.deepEqual(params, [7, 'merged', hostile]);
  assert.doesNotMatch(sql, /DROP TABLE/);
});

test('updatePullRequest ignores unknown field names and skips the query when nothing is left', async () => {
  const db = recordingDb();
  await makeStore(db).updatePullRequest(7, { id: 99, 'state = state; --': 'x' });
  assert.equal(db.calls.length, 0);
});

test('updatePullRequest can set a column back to NULL', async () => {
  const db = recordingDb();
  await makeStore(db).updatePullRequest(7, { closedAt: null });
  assert.deepEqual(db.calls[0].params, [7, null]);
});

test('recordDelivery returns true for a new delivery and false for a redelivery', async () => {
  const fresh = makeStore(recordingDb({ rows: [], rowCount: 1 }));
  const repeat = makeStore(recordingDb({ rows: [], rowCount: 0 }));
  assert.equal(await fresh.recordDelivery({ deliveryId: 'a', event: 'pull_request' }), true);
  assert.equal(await repeat.recordDelivery({ deliveryId: 'a', event: 'pull_request' }), false);
});

test('findUserByGiteaLogin returns null for a missing login without querying', async () => {
  const db = recordingDb();
  assert.equal(await makeStore(db).findUserByGiteaLogin(undefined), null);
  assert.equal(db.calls.length, 0);
});

test('findUserByGiteaLogin returns null when no user matches', async () => {
  assert.equal(await makeStore(recordingDb()).findUserByGiteaLogin('ghost'), null);
});

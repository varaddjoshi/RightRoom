// What src/store.js saves to Elasticsearch must restore to exactly the same engine state.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL;
const store = require('../src/store');
const { createEngine } = require('../src/engine');
const auth = require('../src/auth');

test('engine state survives a save and restore, Maps and all', () => {
  store.reset(Date.now());
  auth.ensureDemoUsers(store.db);
  const engine = createEngine({ store, redirect: () => ({}) });
  engine.joinQueue('310', { handle: 'alice', needs: ['step-free'] }, 'dev-1');
  const sam = store.db.users.get('sam');
  engine.checkin('210', sam, 'front-left');
  engine.release('210', 1, 'back-right');

  const saved = store.toJSON(store.db);
  const back = store.fromJSON(saved);
  // Lossless apart from properties set to undefined, which JSON drops and which read back as undefined anyway.
  assert.equal(store.toJSON(back), saved);
  assert.ok(back.spaces instanceof Map && back.checkins.get('210') instanceof Map && back.offers instanceof Map && back.users instanceof Map);
  assert.equal(back.offers.size, store.db.offers.size);
  assert.equal(back.seq, store.db.seq);

  // An engine on the restored state carries on where the old one stopped.
  store.db = back;
  const again = createEngine({ store, redirect: () => ({}) });
  assert.equal(again.view(again.space('210')).taken, engine.view(engine.space('210')).taken);
  assert.equal(again.roomForUser('210', 'sam').me.checkedIn.zone, 'front-left');
});

test('without ELASTICSEARCH_URL the store stays in memory and saves nothing', async () => {
  assert.equal(await store.restore({ log: { log() {}, error() {} } }), 'memory');
  assert.equal(await store.save(), false);
});

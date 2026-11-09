// Regression tests for issue #23 (engine bugs found by the screen agents) and the follow-ups that came with it.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL;
const store = require('../src/store');
const auth = require('../src/auth');
const { createEngine } = require('../src/engine');
const { redirect } = require('../src/mock/redirect');
const { HEARTBEAT_MS } = require('../src/stream');

function setup(policy) {
  let t = 1_800_000_000_000;
  store.reset(t);
  auth.ensureDemoUsers(store.db);
  const e = createEngine({ store, redirect, now: () => t, policy });
  return { e, db: store.db, tick: (ms) => { t += ms; e.sweep(); }, now: () => t };
}
const holdsOf = (db, handle) => [...db.spaces.values()].flatMap((s) => (s.redirectHolds || []).filter((h) => h.handle === handle).map((h) => ({ room: s.id, until: h.until })));

test('#23 bug 1: a released seat keeps its zone; an accessible zone only goes to someone who stated the need', () => {
  let { e } = setup();
  e.joinQueue('204', { handle: 'bob', needs: [] }, 'd1');
  e.release('204', 1, 'back-right');
  assert.equal(e.roomForUser('204', 'bob').me.queue.offer.zone, 'back-right');

  ({ e } = setup());
  e.joinQueue('204', { handle: 'bob', needs: [] }, 'd1');
  e.joinQueue('204', { handle: 'ada', needs: ['step-free'] }, 'd2');
  e.release('204', 1, 'front-left'); // front-left is 204's accessible zone
  assert.equal(e.roomForUser('204', 'ada').me.queue.offer.zone, 'front-left');
  assert.equal(e.roomForUser('204', 'bob').me.queue.status, 'waiting');
});

test('#23 bug 2: the count is check-ins + correction + held offers', () => {
  let { e } = setup();
  assert.equal(e.view(e.space('204')).taken, 50);
  e.joinQueue('204', { handle: 'bob', needs: [] }, 'd1');
  e.release('204', 1, 'back-right'); // one person left, their seat is now held as an offer
  assert.equal(e.view(e.space('204')).taken, 50);
  ({ e } = setup());
  e.correct('204', -1);
  assert.equal(e.view(e.space('204')).taken, 49);
  e.checkin('204', { handle: 'carol', needs: [] }, 'front-centre');
  assert.equal(e.view(e.space('204')).taken, 50);
});

test('#23 bug 3: asking for a redirect again keeps one hold and does not extend it', () => {
  const { e, db, tick } = setup();
  const sam = db.users.get('sam');
  e.redirect('204', sam);
  const [first] = holdsOf(db, 'sam');
  tick(5 * 60_000);
  e.redirect('204', sam);
  e.redirect('204', sam);
  assert.deepEqual(holdsOf(db, 'sam'), [first]);
});

test('#23 bug 4: opening a console leaves the door the same staff member was on', () => {
  const { e } = setup();
  e.setConsole('204', 'leo', 'open');
  e.setConsole('210', 'leo', 'open');
  assert.equal(e.space('204').staffOn, null);
  assert.equal(e.space('210').staffOn, 'leo');
  e.setConsole('204', 'dana', 'open');
  e.setConsole('210', 'leo', 'leave');
  assert.equal(e.space('204').staffOn, 'dana');
  assert.equal(e.space('210').staffOn, null);
});

test('#23 bug 6: signed out, a redirect is a read-only suggestion with no hold', () => {
  const { e, db } = setup();
  const before = [...db.spaces.values()].reduce((n, s) => n + (s.redirectHolds || []).length, 0);
  const r = e.redirect('204', null);
  assert.ok(r.suggestion && r.suggestion.room);
  assert.equal([...db.spaces.values()].reduce((n, s) => n + (s.redirectHolds || []).length, 0), before);
});

test('claim window: none unless set, so a claimed seat is held until scan-in; a set window still expires it', () => {
  let { e, db, tick } = setup();
  e.joinQueue('310', { handle: 'bob', needs: [] }, 'd1');
  let o = e.roomForUser('310', 'bob').me.queue.offer;
  assert.equal(e.claim(o.id, 'bob').scanBy, null);
  tick(3 * 3600_000);
  assert.equal(db.offers.get(o.id).status, 'claimed');

  ({ e, db, tick } = setup({ claimWindowMs: (needs) => (needs.length ? 15 : 10) * 60_000 }));
  e.joinQueue('310', { handle: 'bob', needs: [] }, 'd1');
  o = e.roomForUser('310', 'bob').me.queue.offer;
  e.claim(o.id, 'bob');
  tick(11 * 60_000);
  assert.equal(db.offers.get(o.id).status, 'expired');
});

test('live stream pings inside the 15 s idle timeout of the hackathon gateway', () => {
  assert.ok(HEARTBEAT_MS < 15_000);
});

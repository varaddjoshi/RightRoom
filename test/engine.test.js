const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('../src/mock/seed');
const { createEngine, OFFER_MS, CONFIRM_MS } = require('../src/engine');
const { redirect } = require('../src/mock/redirect');
const { rush } = require('../src/routes/api');

function setup() {
  let t = 1_000_000;
  const store = { db: seed(t) };
  const events = [];
  const engine = createEngine({ store, redirect, publish: (type, data) => events.push({ type, ...data }), now: () => t });
  return { engine, db: store.db, events, tick: (ms) => { t += ms; } };
}
const sam = { handle: 'sam', needs: ['step-free'], interests: ['observability'] };
const ann = { handle: 'ann', needs: [], interests: [] };
const bob = { handle: 'bob', needs: [], interests: [] };

test('50 people try for 5 seats: exactly 5 win', () => {
  const { engine, db } = setup();
  assert.equal(rush(engine, db).winners, 5);
});

test('a claimed offer cannot be claimed twice', () => {
  const { engine, db } = setup();
  engine.release('204', 1, 'back-right');
  engine.joinQueue('204', ann);
  const o = [...db.offers.values()][0];
  engine.claim(o.id, 'ann');
  assert.throws(() => engine.claim(o.id, 'ann'), /claimed/);
});

test('room 204 starts Full; joining queues instead of offering', () => {
  const { engine } = setup();
  assert.equal(engine.view(engine.space('204')).status, 'full');
  const q = engine.joinQueue('204', ann);
  assert.equal(q.status, 'waiting');
  assert.equal(q.position, 1);
});

test('release offers seats to the queue first, capped at people counted inside', () => {
  const { engine, db } = setup();
  engine.joinQueue('204', ann);
  engine.joinQueue('204', bob);
  const r = engine.release('204', 2, 'back-right');
  assert.equal(r.released, 2);
  assert.equal(r.offers, 2);
  assert.equal(engine.taken(engine.space('204')), 50); // offers are held seats, so still at capacity
  const capped = engine.release('204', 500, null);
  assert.equal(capped.released, 48); // only the 48 people counted inside can be released, never the held offers
  assert.ok([...db.offers.values()].every((o) => o.zone === 'back-right'));
});

test('an expired offer passes to the next person, who goes back of the queue', () => {
  const { engine, db, tick } = setup();
  engine.joinQueue('204', ann);
  engine.joinQueue('204', bob);
  engine.release('204', 1, 'back-right');
  const first = [...db.offers.values()][0];
  assert.equal(first.handle, 'ann');
  tick(OFFER_MS + 1);
  engine.sweep();
  assert.equal(first.status, 'expired');
  const next = [...db.offers.values()].find((o) => o.status === 'offered');
  assert.equal(next.handle, 'bob');
  assert.equal(next.zone, 'back-right');
});

test("I'm leaving drops the count and offers the seat without counting it twice", () => {
  const { engine, db } = setup();
  const sp = engine.space('210');
  engine.checkin('210', sam, 'front-left');
  const before = engine.taken(sp);
  engine.leave('210', 'sam');
  assert.equal(engine.taken(sp), before - 1); // nobody waiting: the seat is simply free
  for (let i = 0; i < 5; i++) engine.checkin('220', { handle: `p${i}` }, 'back-left');
  engine.checkin('220', bob, 'back-centre'); // 220 now 40 of 40
  engine.joinQueue('220', ann);
  const t220 = engine.taken(engine.space('220'));
  engine.leave('220', 'bob');
  assert.equal(engine.taken(engine.space('220')), t220); // seat moved from bob's check-in to ann's offer
  const offer = [...db.offers.values()].find((o) => o.handle === 'ann');
  assert.equal(offer.zone, 'back-centre');
});

test('Full is pushed straight away with nobody on the door', () => {
  const { engine } = setup();
  const sp = engine.space('220'); // 34 of 40
  for (let i = 0; i < 6; i++) engine.checkin('220', { handle: `p${i}` }, 'back-left');
  assert.equal(engine.view(sp).status, 'full');
});

test('with a staff console open, Full waits for confirm or 30 seconds', () => {
  const { engine, events, tick } = setup();
  const sp = engine.space('220');
  engine.setConsole('220', 'leo', 'open');
  for (let i = 0; i < 6; i++) engine.checkin('220', { handle: `p${i}` }, 'back-left');
  assert.equal(engine.view(sp).status, 'filling');
  assert.ok(events.some((e) => e.type === 'confirm' && e.space === '220'));
  tick(CONFIRM_MS + 1);
  engine.sweep();
  assert.equal(engine.view(sp).status, 'full');
});

test('"Not yet, 2 free" corrects the count and offers 2 seats', () => {
  const { engine } = setup();
  const sp = engine.space('220');
  engine.setConsole('220', 'leo', 'open');
  for (let i = 0; i < 6; i++) engine.checkin('220', { handle: `p${i}` }, 'back-left');
  engine.joinQueue('220', ann);
  engine.joinQueue('220', bob);
  engine.confirm('220', 'not_yet', 2, 'back-right');
  assert.equal(sp.correction, -2);
  assert.equal(engine.staffView('220').queue.filter((q) => q.status === 'offered').length, 2);
});

test('an accessible seat goes to someone who stated the need, ahead of earlier people', () => {
  const { engine, db } = setup();
  engine.joinQueue('204', ann);
  engine.joinQueue('204', sam);
  engine.release('204', 1, 'front-left'); // front-left is 204's accessible zone
  const o = [...db.offers.values()][0];
  assert.equal(o.handle, 'sam');
  assert.equal(o.accessible, true);
});

test('an accessible seat is not offered to someone without the need', () => {
  const { engine, db } = setup();
  engine.joinQueue('204', ann);
  engine.release('204', 1, 'front-left');
  assert.equal(db.offers.size, 0);
});

test('one queue place per person', () => {
  const { engine, db } = setup();
  engine.joinQueue('204', ann, 'dev1');
  engine.joinQueue('204', ann, 'dev1');
  engine.joinQueue('204', { handle: 'guest-x', needs: [] }, 'dev1');
  assert.equal(db.queue.filter((q) => q.space === '204').length, 1);
});

test('claim then check in keeps the count steady; check-in elsewhere checks you out', () => {
  const { engine, db } = setup();
  engine.joinQueue('204', ann);
  engine.release('204', 1, 'back-right');
  const o = [...db.offers.values()][0];
  engine.claim(o.id, 'ann');
  const t = engine.taken(engine.space('204'));
  engine.checkin('204', ann);
  assert.equal(engine.taken(engine.space('204')), t);
  const t210 = engine.taken(engine.space('210'));
  engine.checkin('210', ann, 'front-centre');
  assert.equal(engine.taken(engine.space('210')), t210 + 1);
  assert.equal(engine.space('204') && db.checkins.get('204').has('ann'), false);
});

test('venue registration admits, and an unscanned admission expires to the waitlist', () => {
  const { engine, db, tick } = setup();
  const venue = engine.space('venue');
  venue.capacity = 172;
  assert.equal(engine.register(sam).status, 'admitted');
  assert.equal(engine.register(ann).status, 'waiting');
  tick(31 * 60_000);
  engine.sweep();
  assert.equal(engine.myVenue('sam').status, 'expired');
  assert.equal(engine.myVenue('ann').status, 'admitted');
  assert.ok(db.queue.length > 0);
});

test('redirect never suggests a stairs-only room to someone who needs step-free, and holds a place', () => {
  const { engine, db } = setup();
  const r = engine.redirect('204', sam);
  assert.ok(r.suggestion);
  assert.notEqual(r.suggestion.room, '305');
  assert.ok(r.rejected.some((x) => x.room === '305'));
  assert.equal(db.spaces.get(r.suggestion.room).redirectHolds.length, 1);
});

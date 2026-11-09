// Agent G: every screen shows the same numbers (redirect vs tiles, checking state, venue, correction, leaving).
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('../src/mock/seed');
const { createEngine, OFFER_MS } = require('../src/engine');
const { redirect } = require('../src/mock/redirect');

function setup() {
  let t = 1_000_000;
  const store = { db: seed(t) };
  const engine = createEngine({ store, redirect, now: () => t });
  return { engine, db: store.db, tick: (ms) => { t += ms; } };
}
const user = (handle) => ({ handle, needs: [], interests: ['observability'] });

test('redirect shows the same free seats as the tiles, and says how many are already on their way', () => {
  const { engine } = setup();
  for (let i = 0; i < 6; i++) engine.redirect('204', user(`u${i}`));
  const r = engine.redirect('204', user('sam'));
  const tile = engine.view(engine.space(r.suggestion.room));
  assert.equal(r.suggestion.free, tile.free);
  assert.equal(r.suggestion.heldForRedirects, 6); // others on their way; sam's own hold doesn't count against sam
  assert.equal(tile.heldForRedirects, 7);
  assert.ok(r.reasons.some((x) => x.includes(`${tile.free} seats free`) && x.includes('already on their way')), r.reasons.join(' | '));
});

test('at capacity with staff confirming the room is "checking", never "filling" with 0 free', () => {
  const { engine } = setup();
  engine.setConsole('210', 'leo', 'open');
  for (let i = 0; i < 9; i++) engine.checkin('210', { handle: `p${i}` });
  const v = engine.view(engine.space('210'));
  assert.equal(v.free, 0);
  assert.equal(v.status, 'checking');
  assert.ok(v.pendingConfirm > 0);
  engine.confirm('210', 'full');
  assert.equal(engine.view(engine.space('210')).status, 'full');
});

test('venue reports admitted and scanned in separately', () => {
  const { engine, db } = setup();
  db.queue.find((q) => q.space === 'venue').scannedIn = false;
  const v = engine.view(engine.space('venue'));
  assert.equal(v.taken, 171);
  assert.equal(v.scannedIn, 170);
});

test('after a release and a check-in the count includes the staff correction; zone fill counts scans only', () => {
  const { engine, db } = setup();
  engine.setConsole('204', 'leo', 'open');
  engine.joinQueue('204', user('sam'));
  engine.release('204', 1);
  const o = [...db.offers.values()].find((x) => x.handle === 'sam');
  engine.claim(o.id, 'sam');
  engine.checkin('204', user('sam'));
  const s = engine.staffView('204');
  assert.equal(s.taken, 50);
  assert.equal(s.correction, -1);
  assert.equal(Object.values(s.zoneFill).reduce((a, b) => a + b, 0), 51);
  assert.equal(engine.view(engine.space('204')).taken, s.taken); // big screen and console read the same count
});

test('Full rooms with no console open are visible to the organiser board', () => {
  const { engine } = setup();
  const rooms = engine.floors('organiser').flatMap((f) => f.rooms);
  const needs = rooms.filter((r) => !r.staffOn && (r.queue > 0 || r.status !== 'free')).map((r) => r.id).sort();
  assert.ok(needs.includes('204') && needs.includes('305'));
});

test('"I\'m leaving" lowers the count and offers the seat to the queue', () => {
  const { engine, db, tick } = setup();
  engine.checkin('204', user('sam'));       // 51 inside a 50 room is fine for the test: sam is counted
  const before = engine.view(engine.space('204')).taken;
  engine.joinQueue('204', user('ann'));
  engine.leave('204', 'sam');
  const v = engine.view(engine.space('204'));
  const offer = [...db.offers.values()].find((x) => x.handle === 'ann');
  // 51 -> 50 is still at capacity, so no offer yet; the next leaver frees a seat.
  assert.equal(v.taken, before - 1);
  assert.equal(offer, undefined);
  engine.leave('204', 'stand-in-204-0');
  const after = engine.view(engine.space('204'));
  const o2 = [...db.offers.values()].find((x) => x.handle === 'ann');
  assert.ok(o2 && o2.status === 'offered');
  assert.equal(after.taken, 50); // 49 inside + 1 held offer: never counted twice
  tick(OFFER_MS + 1);
  engine.sweep(); // missed offer: ann goes to the back of the queue and, as the only one waiting, gets a fresh offer
  assert.equal(engine.view(engine.space('204')).taken, 50);
  assert.ok([...db.offers.values()].some((x) => x.handle === 'ann' && x.status === 'offered' && x.id !== o2.id));
});

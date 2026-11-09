// GET /api/me/places: every room a person is seated, holding or queued in (decision 34), with their # in each line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('../src/mock/seed');
const { createEngine } = require('../src/engine');
const { redirect } = require('../src/mock/redirect');

function setup() {
  const store = { db: seed(1_000_000) };
  return createEngine({ store, redirect, now: () => 1_000_000 });
}
const person = (handle) => ({ handle, needs: [], interests: [] });

test('queued in two full rooms: one row per room with its own position and line length', () => {
  const engine = setup();
  engine.joinQueue('204', person('a'));
  engine.joinQueue('204', person('sam'));
  engine.joinQueue('305', person('sam'));
  engine.joinQueue('305', person('b'));
  const { rooms } = engine.myPlaces('sam');
  const by = Object.fromEntries(rooms.map((r) => [r.room, r]));
  assert.equal(rooms.length, 2);
  assert.deepEqual([by['204'].status, by['204'].position, by['204'].of, by['204'].title], ['waiting', 2, 2, 'eBPF deep dive']);
  assert.deepEqual([by['305'].status, by['305'].position, by['305'].of, by['305'].floor], ['waiting', 1, 2, 3]);
});

test('seated in one room and queued in another shows both, offers first', () => {
  const engine = setup();
  engine.joinQueue('204', person('sam'));
  engine.checkin('210', person('sam'), 'back-left');
  engine.release('305', 1, 'front-right');
  engine.joinQueue('305', person('sam'));
  const { rooms } = engine.myPlaces('sam');
  assert.deepEqual(rooms.map((r) => [r.room, r.status]), [['305', 'offered'], ['210', 'checkedIn'], ['204', 'waiting']]);
  assert.equal(rooms[1].zone, 'back-left');
  assert.equal(rooms[0].zone, 'front-right');
  assert.ok(rooms[0].offerExpiresAt > 1_000_000);
});

test('a claimed seat shows its code; a guest is found by device', () => {
  const engine = setup();
  engine.release('305', 1, 'front-right');
  const o = engine.joinQueue('305', person('sam')).offer;
  const claimed = engine.claim(o.id, 'sam');
  assert.equal(engine.myPlaces('sam').rooms[0].code, claimed.code);
  engine.joinQueue('204', person('guest-old'), 'dev1');
  assert.deepEqual(engine.myPlaces('guest-new', 'dev1').rooms.map((r) => r.room), ['204']);
  assert.deepEqual(engine.myPlaces('guest-new', 'dev2').rooms, []);
});

// SLO 2 and the other Dash0 proof numbers (src/slo2.js), driven through a real seat engine. A fake meter is
// registered before the code loads, so this needs no OpenTelemetry SDK and no Dash0. Timers are faked, so the
// 30 s and 15 min windows take no real time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { metrics } = require('@opentelemetry/api');

const rec = [];
metrics.setGlobalMeterProvider({
  getMeter: () => ({
    createHistogram: (name) => ({ record: (value, attrs) => rec.push({ name, value, attrs }) }),
    createCounter: (name) => ({ add: (value, attrs) => rec.push({ name, value, attrs: attrs || {} }) }),
  }),
});

const slo2 = require('../src/slo2');
const { seed } = require('../src/mock/seed');
const { createEngine } = require('../src/engine');
const { redirect } = require('../src/mock/redirect');

const by = (name) => rec.filter((r) => r.name === name);
const attrsOf = (name) => by(name).map((r) => r.attrs);

function setup() {
  slo2.reset();
  rec.length = 0;
  let t = 1_000_000; // the engine's clock
  let wall = 5_000_000; // real elapsed time, which is what the SLO measures
  const store = { db: seed(t) };
  const engine = createEngine({ store, redirect, publish: (type, data, to) => slo2.observe(type, data, to), now: () => t });
  slo2.instrument({ engine, store, clock: () => wall });
  return { engine, store, db: store.db, advance: (ms) => { wall += ms; t += ms; } };
}
const ann = { handle: 'ann', needs: [], interests: [] };

test('turned away from a full room, then offered within 30 s: a response in time', () => {
  const { engine, advance } = setup();
  assert.equal(engine.joinQueue('204', ann).status, 'waiting', 'room 204 starts Full');
  advance(4_000);
  engine.release('204', 1, 'back-right');
  assert.deepEqual(attrsOf('rightroom.slo2.responses'), [{ 'slo2.outcome': 'offer', 'slo2.within_30s': true }]);
  assert.deepEqual(by('rightroom.slo2.time_to_response').map((r) => [r.value, r.attrs]), [[4_000, { 'slo2.outcome': 'offer' }]]);
});

test('neither an offer nor a redirect in 30 s is counted as a MISS, and a late offer is not counted again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, advance } = setup();
  engine.joinQueue('204', ann);
  t.mock.timers.tick(30_000);
  advance(30_000);
  assert.deepEqual(attrsOf('rightroom.slo2.responses'), [{ 'slo2.outcome': 'none', 'slo2.within_30s': false }]);
  assert.equal(by('rightroom.slo2.time_to_response').length, 0, 'a miss has no response time');
  engine.release('204', 1, 'back-right');
  assert.equal(by('rightroom.slo2.responses').length, 1, 'the late offer does not add a second row');
});

test('a redirect shown within 30 s counts as the response', () => {
  const { engine, advance } = setup();
  engine.joinQueue('204', ann);
  advance(2_500);
  const res = engine.redirect('204', ann);
  assert.ok(res.suggestion && res.suggestion.room, 'the seed has a room with free seats to suggest');
  assert.deepEqual(attrsOf('rightroom.slo2.responses'), [{ 'slo2.outcome': 'redirect', 'slo2.within_30s': true }]);
  assert.equal(by('rightroom.slo2.time_to_response')[0].value, 2_500);
});

test('leaving the queue before 30 s is not a miss', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  engine.joinQueue('204', ann);
  engine.leaveQueue('204', 'ann');
  t.mock.timers.tick(30_000);
  assert.equal(by('rightroom.slo2.responses').length, 0);
});

test('joining a room that has free seats is not being turned away', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  assert.equal(engine.joinQueue('310', ann).status, 'offered', 'a free seat is offered at once');
  t.mock.timers.tick(30_000);
  assert.equal(by('rightroom.slo2.responses').length, 0);
});

test('joining twice starts one clock, and the wrapper changes nothing the engine returns', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  const first = engine.joinQueue('204', ann);
  const second = engine.joinQueue('204', ann);
  assert.equal(first.status, 'waiting');
  assert.deepEqual(second, first);
  t.mock.timers.tick(30_000);
  assert.equal(by('rightroom.slo2.responses').length, 1);
});

test('stand-in people and the load-test room never reach the numbers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, db } = setup();
  engine.joinQueue('204', { handle: 'stand-in-q-1', needs: [] });
  db.spaces.get('310').test = true;
  db.spaces.get('310').capacity = 0;
  engine.joinQueue('310', ann);
  t.mock.timers.tick(30_000);
  assert.equal(by('rightroom.slo2.responses').length, 0);
});

test('redirect success: followed when they check in at the suggested room, not followed after 15 minutes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  const bob = { handle: 'bob', needs: [], interests: [] };
  const a = engine.redirect('204', ann);
  const b = engine.redirect('204', bob);
  engine.redirect('204', ann); // a refresh of the same redirect is not a second one
  engine.checkin(a.suggestion.room, ann);
  assert.deepEqual(attrsOf('rightroom.redirects'), [{ 'redirect.followed': true }]);
  t.mock.timers.tick(15 * 60_000);
  assert.deepEqual(attrsOf('rightroom.redirects'), [{ 'redirect.followed': true }, { 'redirect.followed': false }]);
  engine.checkin(b.suggestion.room, bob);
  assert.equal(by('rightroom.redirects').length, 2, 'checking in after the window is settled adds nothing');
});

test('one person looping join / redirect / leave adds ONE SLO 2 outcome, not one per round (Gitar finding 1)', () => {
  const { engine } = setup();
  for (let i = 0; i < 5; i++) {
    engine.joinQueue('204', ann);
    engine.redirect('204', ann);
    engine.leaveQueue('204', 'ann');
  }
  assert.equal(by('rightroom.slo2.responses').length, 1);
  assert.equal(by('rightroom.slo2.time_to_response').length, 1);
});

test('looping redirect / check in adds ONE settled redirect, not one per round', () => {
  const { engine } = setup();
  for (let i = 0; i < 4; i++) {
    const r = engine.redirect('204', ann);
    engine.checkin(r.suggestion.room, ann);
  }
  assert.equal(by('rightroom.redirects').length, 1);
});

test('a miss is counted once per person per room, even if they are turned away again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  engine.joinQueue('204', ann);
  t.mock.timers.tick(30_000);
  engine.leaveQueue('204', 'ann');
  engine.joinQueue('204', ann);
  t.mock.timers.tick(30_000);
  assert.equal(by('rightroom.slo2.responses').length, 1);
});

test('a guest re-joining from the same device under another handle gets no clock of their own (Gitar finding 2)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = setup();
  const first = engine.joinQueue('204', { handle: 'guest-1', needs: [] }, 'device-A');
  const second = engine.joinQueue('204', { handle: 'guest-2', needs: [] }, 'device-A');
  assert.equal(first.status, 'waiting');
  assert.equal(second.status, 'waiting', 'the engine hands back the existing entry');
  t.mock.timers.tick(30_000);
  assert.deepEqual(attrsOf('rightroom.slo2.responses'), [{ 'slo2.outcome': 'none', 'slo2.within_30s': false }], 'one miss, for guest-1 only');
});

test('staff overrides on the load-test room are not counted (Gitar finding 3)', () => {
  const { engine, db } = setup();
  db.spaces.get('204').test = true;
  engine.override('204', 'full');
  assert.equal(by('rightroom.staff.overrides').length, 0);
});

test('staff overrides are counted by mode', () => {
  const { engine } = setup();
  engine.override('204', 'not_full');
  engine.override('204', 'full');
  engine.override('204', 'clear');
  assert.deepEqual(attrsOf('rightroom.staff.overrides'), [{ 'override.mode': 'not_full' }, { 'override.mode': 'full' }, { 'override.mode': 'clear' }]);
});

test('Full events count only a real transition to Full', () => {
  setup();
  slo2.observe('status', { space: '305', status: 'full' }); // first time seen already Full (after a restart): not an event
  slo2.observe('status', { space: '310', status: 'filling' });
  slo2.observe('status', { space: '310', status: 'full' }); // filling -> full: one event
  slo2.observe('status', { space: '310', status: 'full' }); // re-published, unchanged: not an event
  assert.equal(by('rightroom.room.full_events').length, 1);
  slo2.observe('status', { space: '310', status: 'free' });
  slo2.observe('status', { space: '310', status: 'full' }); // went Full again: a second event
  assert.equal(by('rightroom.room.full_events').length, 2);
});

test('accessible seats: every offer is counted, and one to a person with no stated need is flagged', () => {
  const { store } = setup();
  store.db.queue.push({ handle: 'zed', space: '204', status: 'offered', needs: [] });
  store.db.queue.push({ handle: 'sam', space: '204', status: 'offered', needs: ['step-free'] });
  slo2.observe('offer', { space: '204', zone: 'front-left', accessible: true }, { handle: 'sam' });
  assert.equal(by('rightroom.slo2.accessible_offers').length, 1);
  assert.equal(by('rightroom.slo2.accessible_seat_misassigned').length, 0, 'a person with a need is fine');
  slo2.observe('offer', { space: '204', zone: 'front-left', accessible: true }, { handle: 'zed' });
  assert.equal(by('rightroom.slo2.accessible_offers').length, 2);
  assert.equal(by('rightroom.slo2.accessible_seat_misassigned').length, 1, 'no stated need: the guard fires');
  slo2.observe('offer', { space: '204', zone: 'back-right', accessible: false }, { handle: 'zed' });
  assert.equal(by('rightroom.slo2.accessible_offers').length, 2, 'an ordinary seat is not an accessible offer');
});

test('no metric attribute carries a handle, an id or free text', () => {
  const { engine, advance } = setup();
  engine.joinQueue('204', ann);
  advance(1_000);
  engine.release('204', 1, 'back-right');
  engine.redirect('204', { handle: 'bob', needs: [] });
  engine.override('204', 'full');
  for (const r of rec) for (const [k, v] of Object.entries(r.attrs || {})) {
    assert.match(k, /^(slo2\.|redirect\.|override\.)/, `unexpected attribute ${k}`);
    assert.ok(typeof v === 'boolean' || ['offer', 'redirect', 'none', 'full', 'not_full', 'clear', 'other'].includes(v), `unexpected value ${v}`);
  }
});

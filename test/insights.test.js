const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { HISTORY } = require('../src/mock/history');
const seed = require('../src/mock/insights-seed');
const { predictFill, backtest } = require('../src/forecast');
const { wifiMedians, interestCounts, metrics, topicsFor } = require('../src/insights');
const { makeRouter } = require('../src/routes/insights');

test('forecast is deterministic and explains itself with 3 past talks', () => {
  const s = seed.SESSIONS[0];
  const a = predictFill(s, HISTORY), b = predictFill(s, HISTORY);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.because.length, 3);
  assert.ok(a.expectedFill > 0 && a.expectedFill <= 1);
  assert.ok(['low', 'medium', 'high'].includes(a.risk));
  assert.strictEqual(a.source, 'stand-in');
});

test('backtest numbers are sensible', () => {
  const bt = backtest(HISTORY);
  assert.strictEqual(bt.talks, 40);
  assert.ok(bt.accuracy >= 0 && bt.accuracy <= 1);
  assert.ok(bt.meanAbsError >= 0 && bt.meanAbsError <= 1);
  assert.ok(bt.accuracy >= 0.6, `accuracy too low to demo: ${bt.accuracy}`);
});

test('interest groups under 5 are hidden', () => {
  const r = interestCounts(seed.USERS, seed.TAG_LABELS);
  const by = Object.fromEntries(r.groups.map(g => [g.label, g.count]));
  assert.strictEqual(by.Observability, 52);
  assert.strictEqual(by.eBPF, 37);
  assert.strictEqual(by['Platform eng'], 9);
  assert.ok(!('Helm' in by) && !('Wasm' in by));
  assert.strictEqual(r.hiddenGroups, 2);
});

test('wifi medians on a tiny fixture', () => {
  const m = wifiMedians([
    { space: 'x', zone: 'a', mbps: 10, ms: 30 },
    { space: 'x', zone: 'a', mbps: 20, ms: 50 },
    { space: 'x', zone: 'b', mbps: 40, ms: 10 },
  ]);
  assert.strictEqual(m.x.mbps, 20);
  assert.strictEqual(m.x.zones.a.mbps, 15);
  assert.strictEqual(m.x.zones.b.ms, 10);
  assert.ok(wifiMedians(seed.WIFI)['204'].zones['back-left'].mbps <= 5);
});

test('topics for 204 surface the scenario terms', () => {
  const t = topicsFor('204', seed.COMMENTS, seed.SESSIONS).topics.map(x => x.term);
  assert.ok(t.includes('slides too small'), t.join(', '));
  assert.ok(t.includes('verifier'), t.join(', '));
  assert.ok(t.includes('tracing'), t.join(', '));
});

test('metrics match the event log', () => {
  const m = metrics(seed.LOG);
  assert.strictEqual(m.redirects, 23);
  assert.strictEqual(m.followed, 17);
  assert.strictEqual(m.fullPrompts, 14);
  assert.strictEqual(m.overridden, 1);
});

test('seedInto appends Phase 1 shaped records with ids', () => {
  const db = seed.seedInto({ wifi: [], comments: [], seq: 7 });
  assert.strictEqual(db.wifi.length, seed.WIFI.length);
  assert.ok(db.wifi.every(w => typeof w.space === 'string' && typeof w.at === 'number' && seed.ZONES.includes(w.zone)));
  assert.strictEqual(db.comments[0].id, 8);
  assert.ok(db.comments.every(c => c.space && c.text && typeof c.at === 'number' && c.hidden === false));
  db.wifi[0].mbps = -1;
  assert.notStrictEqual(seed.WIFI[0].mbps, -1, 'seed records are copied, not shared');
});

test('topics skip hidden comments', () => {
  const comments = seed.COMMENTS.map(c => ({ ...c, hidden: c.space === '204' && /slides too small/i.test(c.text) }));
  const t = topicsFor('204', comments, seed.SESSIONS).topics.map(x => x.term);
  assert.ok(!t.includes('slides too small'), t.join(', '));
});

test('router serves labelled reads over an injected db', async () => {
  const db = seed.seedInto({ wifi: [], comments: [], seq: 0 });
  const app = express();
  app.use('/api', makeRouter({ db: () => db }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.strictEqual((await fetch(base + '/sessions/999/topics')).status, 404);
    for (const p of ['/forecast', '/forecast/backtest', '/wifi', '/sessions/204/topics', '/insights/interests', '/metrics', '/tables', '/alerts', '/team-finder']) {
      const res = await fetch(base + p);
      assert.strictEqual(res.status, 200, p);
      const body = await res.json();
      // /wifi: source is the backend, label says what the numbers are made of
      if (p === '/wifi') assert.deepStrictEqual([body.source, body.label], ['memory', 'stand_in'], p);
      else assert.strictEqual(body.source, 'stand-in', p);
    }
    db.wifi.push({ space: '204', zone: 'back-left', mbps: 9, ms: 40, at: Date.now() }); // a live reading from Phase 1's POST
    assert.strictEqual((await (await fetch(base + '/wifi')).json()).label, 'mixed');
    assert.strictEqual((await fetch(base + '/wifi', { method: 'POST' })).status, 404, 'writes belong to Phase 1');
  } finally {
    server.close();
  }
});

test('fillStandIns covers rooms with unknown ids and adds attendees, once', () => {
  const db = { spaces: new Map([['kc-a', { id: 'kc-a', type: 'room', floor: 1, capacity: 90 }], ['venue', { id: 'venue', type: 'venue' }]]),
    checkins: new Map(), users: new Map(), wifi: [], comments: [], seq: 0 };
  seed.fillStandIns(db);
  assert.equal(db.wifi.filter((w) => w.space === 'kc-a').length, 18);
  assert.ok(db.heatStandIns.get('kc-a').size > 0);
  assert.ok(db.comments.some((c) => c.space === 'kc-a'));
  assert.ok(!db.wifi.some((w) => w.space === 'venue'));
  assert.equal(db.users.size, 120);
  assert.ok([...db.users.values()].every((u) => !u.hash && u.standIn));
  const sizes = [db.wifi.length, db.comments.length, db.users.size];
  seed.fillStandIns(db);
  assert.deepEqual([db.wifi.length, db.comments.length, db.users.size], sizes);
});

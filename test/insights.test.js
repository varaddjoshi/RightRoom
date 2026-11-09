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
    { room: 'x', zone: 'a', mbps: 10, ms: 30 },
    { room: 'x', zone: 'a', mbps: 20, ms: 50 },
    { room: 'x', zone: 'b', mbps: 40, ms: 10 },
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

test('router validates input and labels responses', async () => {
  const app = express();
  app.use('/api', makeRouter());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await post('/wifi', { room: '999', zone: 'back-left', mbps: 5, ms: 40 })).status, 400);
    assert.strictEqual((await post('/wifi', { room: '204', zone: 'roof', mbps: 5, ms: 40 })).status, 400);
    assert.strictEqual((await post('/wifi', { room: '204', zone: 'back-left', mbps: '5', ms: 40 })).status, 400);
    assert.strictEqual((await post('/wifi', { room: '204', zone: 'back-left', mbps: 5, ms: 40 })).status, 201);
    assert.strictEqual((await post('/comments', { room: '204', text: 'x'.repeat(281) })).status, 400);
    assert.strictEqual((await post('/comments', { room: '204', text: '  ' })).status, 400);
    assert.strictEqual((await post('/comments', { room: '204', text: 'Great talk' })).status, 201);
    assert.strictEqual((await fetch(base + '/sessions/999/topics')).status, 404);
    for (const p of ['/forecast', '/forecast/backtest', '/wifi', '/sessions/204/topics', '/insights/interests', '/metrics', '/tables', '/alerts', '/team-finder']) {
      const res = await fetch(base + p);
      assert.strictEqual(res.status, 200, p);
      assert.strictEqual((await res.json()).source, 'stand-in', p);
    }
  } finally {
    server.close();
  }
});

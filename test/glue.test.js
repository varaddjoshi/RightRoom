const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.DEMO_PASSWORD;
const { app, store } = require('../server');
const { HISTORY } = require('../src/mock/history');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

async function login(handle) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, password: 'rightroom-demo' }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });

test('insight endpoints are mounted under /api', async () => {
  for (const p of ['/api/forecast', '/api/forecast/backtest', '/api/wifi', '/api/sessions/204/topics', '/api/metrics']) {
    assert.equal((await get(p)).status, 200, p);
  }
  const f = await (await get('/api/forecast')).json();
  const risk = Object.fromEntries(f.sessions.map((s) => [s.room, s.risk]));
  assert.equal(risk['204'], 'high');
  assert.equal(risk['305'], 'high'); // the demo scenario shows 305 full
  assert.equal(risk['210'], 'medium');
});

test('interest counts are organiser-only', async () => {
  assert.equal((await get('/api/insights/interests', await login('sam'))).status, 403);
  assert.equal((await get('/api/insights/interests', await login('dana'))).status, 200);
});

test('sim reset brings the stand-in Wi-Fi readings and comments back', async () => {
  const before = { wifi: store.db.wifi.length, comments: store.db.comments.length };
  assert.ok(before.wifi > 0 && before.comments > 0);
  const r = await fetch(`${base}/api/sim/reset`, { method: 'POST', headers: { cookie: await login('dana') } });
  assert.equal(r.status, 200);
  assert.deepEqual({ wifi: store.db.wifi.length, comments: store.db.comments.length }, before);
});

test('every room session uses tags the forecast history knows', () => {
  const known = new Set(HISTORY.flatMap((h) => h.tags));
  for (const s of store.db.spaces.values()) for (const t of s.tags || []) assert.ok(known.has(t), `${s.id}: ${t}`);
});

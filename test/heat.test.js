const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');

const { app } = require('../server');
const store = require('../src/store');
const wifi = require('../src/wifi');
const { crowdBand, heat } = require('../src/heat');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

const PASSWORD = process.env.DEMO_PASSWORD || 'rightroom-demo';
async function login(handle) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, password: PASSWORD }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const get = async (p, cookie) => (await fetch(base + p, { headers: cookie ? { cookie } : {} })).json();

test('bands: Wi-Fi good/ok/weak and crowd quiet/busy/packed', () => {
  assert.deepEqual([wifi.band(30), wifi.band(25), wifi.band(10), wifi.band(7.9), wifi.band(null)], ['good', 'good', 'ok', 'weak', null]);
  assert.deepEqual([crowdBand(0), crowdBand(0.4), crowdBand(0.84), crowdBand(0.85), crowdBand(1)], ['quiet', 'busy', 'busy', 'packed', 'packed']);
});

test('record keeps the reading in memory and summarize gives medians, counts and bands per room and zone', () => {
  const db = { wifi: [] };
  for (const mbps of [4, 6, 50]) wifi.record(db, { space: 'x', zone: 'back-left', mbps, ms: 100, at: 1 });
  wifi.record(db, { space: 'x', zone: 'front-left', mbps: 40, ms: 20, at: 5 });
  const s = wifi.summarize(db.wifi).x;
  assert.equal(db.wifi.length, 4);
  assert.deepEqual({ mbps: s.mbps, count: s.count, last: s.last, band: s.band }, { mbps: 23, count: 4, last: 5, band: 'ok' });
  assert.deepEqual({ mbps: s.zones['back-left'].mbps, band: s.zones['back-left'].band }, { mbps: 6, band: 'weak' });
});

test('density is check-ins per zone over capacity / 9, capped at 1', () => {
  const sp = { id: 'h', capacity: 90 }; // 10 seats per zone
  const m = new Map([['a', { zone: 'front-left' }], ['b', { zone: 'front-left' }], ['c', { zone: 'back-right' }]]);
  for (let i = 0; i < 20; i++) m.set(`p${i}`, { zone: 'middle-centre' });
  const h = heat({ checkins: new Map([['h', m]]), wifi: [] }, sp);
  const z = Object.fromEntries(h.zones.map((x) => [x.zone, x.crowd]));
  assert.deepEqual(z['front-left'], { count: 2, density: 0.2, band: 'quiet' });
  assert.deepEqual(z['middle-centre'], { count: 20, density: 1, band: 'packed' });
  assert.equal(h.zones.length, 9);
});

test('GET /api/heat returns all 9 zones with crowd and wifi (or null), never an empty grid', async () => {
  const h = await get('/api/heat?room=204');
  assert.equal(h.room, '204');
  assert.ok(['memory', 'elasticsearch'].includes(h.source));
  assert.equal(h.zones.length, 9);
  for (const z of h.zones) {
    assert.deepEqual(Object.keys(z.crowd).sort(), ['band', 'count', 'density']);
    assert.ok(z.wifi === null || ['mbps', 'ms', 'count', 'band'].every((k) => k in z.wifi));
  }
  assert.ok(h.zones.some((z) => z.wifi), 'stand-in readings give 204 Wi-Fi zones');
  assert.ok(!Number.isNaN(Date.parse(h.updatedAt)));
  assert.equal((await fetch(`${base}/api/heat?room=nope`)).status, 404);
});

test('/api/floors tiles get wifiStats and a heat summary next to the old fields', async () => {
  const floors = await get('/api/floors');
  const r204 = floors.flatMap((f) => f.rooms).find((r) => r.id === '204');
  assert.ok(typeof r204.wifi === 'number' || r204.wifi === null, 'old wifi number kept');
  assert.deepEqual(Object.keys(r204.wifiStats).sort(), ['band', 'count', 'mbps', 'ms', 'source']);
  assert.ok('busiest' in r204.heat && 'weakestWifi' in r204.heat);
  const w = await get('/api/wifi');
  assert.ok(['band', 'count', 'mbps', 'readings', 'zones'].every((k) => k in w.rooms['204']));
});

test('staging routes are staff only and validate input', async () => {
  const sam = await login('sam'), leo = await login('leo');
  const post = (p, body, cookie) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.equal((await post('/api/sim/wifi', { space: '210', zone: 'front-left', mbps: 30, ms: 20 }, sam)).status, 403);
  assert.equal((await post('/api/sim/wifi', { space: '210', zone: 'nowhere', mbps: 30, ms: 20 }, leo)).status, 400);
  const before = store.db.wifi.length;
  assert.equal((await post('/api/sim/wifi', { space: '210', zone: 'front-left', mbps: 30, ms: 20 }, leo)).status, 200);
  assert.equal(store.db.wifi.length, before + 1);
  assert.equal(store.db.wifi.at(-1).standIn, true);
});

test('scripts/stage-heat.js gives every room crowd and Wi-Fi data', async () => {
  const out = await new Promise((ok, no) => execFile(process.execPath, [path.join(__dirname, '../scripts/stage-heat.js'), base], { env: { ...process.env, ELASTICSEARCH_URL: '' } }, (e, so, se) => (e ? no(new Error(se || e.message)) : ok(so))));
  assert.match(out, /Staged \d+ Wi-Fi readings \(API\)/);
  for (const f of await get('/api/floors')) for (const r of f.rooms) {
    const h = await get(`/api/heat?room=${r.id}`);
    assert.ok(h.zones.some((z) => z.crowd.count > 0), `room ${r.id} has a crowd`);
    assert.ok(h.zones.some((z) => z.wifi), `room ${r.id} has Wi-Fi zones`);
    const front = h.zones.filter((z) => z.zone.startsWith('front')).reduce((s, z) => s + z.crowd.count, 0);
    const back = h.zones.filter((z) => z.zone.startsWith('back')).reduce((s, z) => s + z.crowd.count, 0);
    assert.ok(front >= back, `room ${r.id}: front ${front} >= back ${back}`);
  }
});

test('Elasticsearch summary and mirror', { skip: !process.env.ELASTICSEARCH_URL && 'needs ELASTICSEARCH_URL' }, async () => {
  const { mirror } = require('../src/heat');
  await mirror(store.db);
  const s = await wifi.summary(store.db);
  assert.equal(s.source, 'elasticsearch');
});

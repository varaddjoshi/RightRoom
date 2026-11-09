const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.DEMO_PASSWORD;
const hasES = !!process.env.ELASTICSEARCH_URL;
const { app } = require('../server');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

async function login(handle) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, password: 'rightroom-demo' }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const get = async (path, cookie) => {
  const r = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  return { status: r.status, body: await r.json() };
};

test('memory search finds eBPF in Room 204 first, and says why', { skip: hasES && 'runs against Elasticsearch instead' }, async () => {
  const { status, body } = await get('/api/search?q=ebpf');
  assert.equal(status, 200);
  assert.equal(body.source, 'memory');
  assert.equal(body.results[0].room, '204');
  assert.ok(body.results[0].why.some((w) => w.includes('ebpf')));
  assert.ok(body.results.every((r) => r.why.length > 0));
});

test('filters: floor, step-free, free seats and status', async () => {
  const floor2 = (await get('/api/search?floor=2')).body.results;
  assert.ok(floor2.length && floor2.every((r) => r.floor === 2));
  const stepFree = (await get('/api/search?stepFree=1')).body.results;
  assert.ok(stepFree.every((r) => r.stepFree) && !stepFree.some((r) => r.room === '305'));
  const free = (await get('/api/search?free=1&limit=20')).body.results;
  assert.ok(free.every((r) => r.free > 0));
  const full = (await get('/api/search?status=full&limit=20')).body.results;
  assert.ok(full.every((r) => r.status === 'full'));
});

test('bad parameters get a 400', async () => {
  for (const q of ['floor=x', 'floor=0', 'status=busy', 'limit=50', 'free=yes', `q=${'a'.repeat(101)}`, 'q=a&q=b']) {
    assert.equal((await get(`/api/search?${q}`)).status, 400, q);
  }
});

test('mine needs a sign-in and only filters by interests', async () => {
  assert.equal((await get('/api/search?mine=1')).status, 401);
  const cookie = await login('sam'); // interests: kubernetes, observability, ebpf
  const { status, body } = await get('/api/search?mine=1&limit=20', cookie);
  assert.equal(status, 200);
  assert.ok(body.results.length && body.results.every((r) => r.why.includes('matches your interests')));
});

test('staff see queue and staff on door; attendees do not', async () => {
  const anon = (await get('/api/search?q=204')).body.results[0];
  assert.ok(!('queue' in anon));
  const staff = (await get('/api/search?q=204', await login('leo'))).body.results[0];
  assert.ok('queue' in staff && 'staffOn' in staff);
});

test('Elasticsearch hybrid search', { skip: !hasES && 'no ELASTICSEARCH_URL' }, async () => {
  const { status, body } = await get('/api/search?q=observability');
  assert.equal(status, 200);
  assert.ok(['elasticsearch', 'memory'].includes(body.source));
  assert.ok(body.results.length > 0);
});

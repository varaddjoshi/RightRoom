// Profile (A2): free interest tags, access needs, starred talks, delete account (decisions 2, 3, 7, 12).
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.DEMO_PASSWORD;
const { app } = require('../server');
const { roomKey } = require('../src/presence');

let base, server;
test.after(() => { server.closeAllConnections?.(); server.close(); });

const jar = {};
async function call(who, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie();
  if (set.length) jar[who] = set.map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, data: await r.json().catch(() => null) };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1]} ${a[2]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };

test.before(async () => {
  await new Promise((done) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done(); }); });
  await ok('dana', 'POST', '/api/login', { handle: 'dana', password: 'rightroom-demo' });
  await ok('dana', 'POST', '/api/sim/reset');
  await ok('riya', 'POST', '/api/signup', { handle: 'riya-me', password: 'long-enough-pw' });
});

test('free interest tags are normalised and capped at 3', async () => {
  const me = await ok('riya', 'PUT', '/api/me', { interests: ['ebpf', 'Platform Eng', 'wasm', 'gitops'] });
  assert.deepEqual(me.interests, ['ebpf', 'platform-eng', 'wasm', 'gitops']);
  const r = await call('riya', 'PUT', '/api/me', { interests: ['wasm', 'gitops', 'finops', 'ai-ops'] });
  assert.equal(r.status, 400);
  assert.equal((await call('riya', 'PUT', '/api/me', { interests: ['x'] })).status, 400);
});

test('new access needs are accepted; unknown ones are rejected', async () => {
  const me = await ok('riya', 'PUT', '/api/me', { needs: ['step-free', 'captions', 'hearing-loop', 'quiet', 'extra-time'] });
  assert.deepEqual(me.needs, ['step-free', 'captions', 'hearing-loop', 'quiet', 'extra-time']);
  assert.equal((await call('riya', 'PUT', '/api/me', { needs: ['diagnosis'] })).status, 400);
});

test('starred talks must be known rooms, at most 50', async () => {
  const me = await ok('riya', 'PUT', '/api/me', { starred: ['204', '210'] });
  assert.deepEqual(me.starred, ['204', '210']);
  assert.equal((await call('riya', 'PUT', '/api/me', { starred: ['nope'] })).status, 400);
  assert.equal((await call('riya', 'PUT', '/api/me', { starred: ['venue'] })).status, 400);
  assert.equal((await call('riya', 'PUT', '/api/me', { starred: Array(51).fill('204') })).status, 400);
  assert.deepEqual((await ok('riya', 'GET', '/api/me')).starred, ['204', '210']);
});

test('only seat needs (step-free, wheelchair) get accessible seats', async () => {
  const { createEngine } = require('../src/engine');
  const db = { seq: 0, queue: [], offers: new Map(), checkins: new Map(), spaces: new Map([['r', { id: 'r', type: 'room', capacity: 1, correction: 0, accessZones: ['front-left'], freeZones: ['front-left'], tags: [] }]]) };
  const engine = createEngine({ store: { db }, redirect: () => null });
  engine.joinQueue('r', { handle: 'quiet-one', needs: ['quiet'] });
  assert.equal(db.offers.size, 0, 'a non-seat need does not take the accessible seat');
  engine.joinQueue('r', { handle: 'wheels', needs: ['wheelchair'] });
  assert.equal([...db.offers.values()][0].handle, 'wheels');
});

test('deleting my account frees my places and signs me out', async () => {
  await ok('riya', 'POST', '/api/event/register');
  await ok('riya', 'POST', '/api/spaces/210/checkin', { zone: 'back-left', k: roomKey('210') });
  const before = await ok('riya', 'GET', '/api/spaces/210');
  const venueBefore = (await ok('riya', 'GET', '/api/event')).venue.taken;
  assert.deepEqual(await ok('riya', 'DELETE', '/api/me'), { deleted: true });
  assert.equal((await call('riya', 'GET', '/api/me')).status, 401);
  assert.equal((await ok('dana', 'GET', '/api/spaces/210')).taken, before.taken - 1);
  assert.equal((await ok('dana', 'GET', '/api/event')).venue.taken, venueBefore - 1);
  assert.equal((await call('riya', 'POST', '/api/login', { handle: 'riya-me', password: 'long-enough-pw' })).status, 401);
  assert.equal((await call('dana', 'DELETE', '/api/me')).status, 409, 'shared demo accounts stay');
});

test('a deleted admitted account lets the next person on the waitlist in', async () => {
  const { venue } = await ok('dana', 'GET', '/api/event');
  const fill = venue.capacity - venue.taken; // admitted places left
  for (let i = 0; i <= fill; i++) {
    await ok(`f${i}`, 'POST', '/api/signup', { handle: `fill-${i}`, password: 'long-enough-pw' });
    await ok(`f${i}`, 'POST', '/api/event/register');
  }
  const last = `f${fill}`;
  assert.equal((await ok(last, 'GET', '/api/event')).me.status, 'waiting');
  await ok('f0', 'DELETE', '/api/me');
  assert.equal((await ok(last, 'GET', '/api/event')).me.status, 'admitted');
});

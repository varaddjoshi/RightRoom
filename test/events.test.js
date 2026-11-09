// Event listings (/api/events, src/routes/events.js): list, detail, bad slug, RSVP, Register through the engine,
// calendar file, per-event "next session" (never merged across events) and the overlap warning.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL;
delete process.env.DEMO_PASSWORD;
process.env.DEMO_CLOCK = '2026-11-10T11:45:00-07:00'; // Tuesday at KubeKon: the live talks are on now
const { app, store } = require('../server');
const { EVENTS } = require('../src/mock/events');
const { ROOMS } = require('../src/mock/seed');

let base, server;
const jar = {};
async function call(who, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie();
  if (set.length) jar[who] = set.map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}

test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); });
  store.reset();
  require('../src/auth').ensureDemoUsers(store.db);
  for (const u of ['sam', 'dana']) await call(u, 'POST', '/api/login', { handle: u, password: 'rightroom-demo' });
});
test.after(() => { server.closeAllConnections?.(); server.close(); });

test('list: both events, KubeKon live with the engine\'s venue numbers', async () => {
  const { status, body } = await call('anon', 'GET', '/api/events');
  assert.equal(status, 200);
  assert.deepEqual(body.map((e) => e.slug), ['kubekon-2026', 'cn-portland-dec-2026']);
  const kk = body[0];
  const live = (await call('anon', 'GET', '/api/event')).body.venue;
  assert.equal(kk.status, 'live');
  assert.equal(kk.capacity, live.capacity);
  assert.equal(kk.going, live.taken);
  assert.equal(body[1].status, 'upcoming');
});

test('detail: agenda keeps the live rooms\' current talks; bad slugs are 404', async () => {
  const { status, body } = await call('anon', 'GET', '/api/events/kubekon-2026');
  assert.equal(status, 200);
  assert.ok(body.sessions.length > 20 && body.faq.length && body.speakers.length && body.venue.address);
  const now = Date.parse(body.now);
  for (const r of ROOMS) {
    const s = body.sessions.find((x) => x.live && x.room === r.id);
    assert.equal(s.title, r.title, `room ${r.id} live talk matches the engine`);
    assert.ok(Date.parse(s.start) <= now && now < Date.parse(s.end), `room ${r.id} talk is on now`);
  }
  for (const bad of ['nope', 'NOPE', '..%2F..', 'a'.repeat(61)]) assert.equal((await call('anon', 'GET', `/api/events/${bad}`)).status, 404, bad);
});

test('calendar file', async () => {
  const r = await fetch(`${base}/api/events/cn-portland-dec-2026/calendar.ics`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/calendar/);
  const ics = await r.text();
  assert.match(ics, /DTSTART:20261204T013000Z\r\n/);
  assert.match(ics, /SUMMARY:Cloud Native Portland: eBPF and Observability Night/);
});

test('RSVP: sign in first, then going, then cancel', async () => {
  assert.equal((await call('anon', 'POST', '/api/events/cn-portland-dec-2026/rsvp')).status, 401);
  const going = await call('sam', 'POST', '/api/events/cn-portland-dec-2026/rsvp');
  assert.equal(going.status, 200);
  assert.deepEqual(going.body.me, { status: 'going' });
  assert.equal(going.body.going, 1);
  assert.equal((await call('sam', 'POST', '/api/events/cn-portland-dec-2026/rsvp')).body.going, 1, 'twice is still once');
  const gone = await call('sam', 'DELETE', '/api/events/cn-portland-dec-2026/rsvp');
  assert.equal(gone.body.me, null);
  assert.equal(gone.body.going, 0);
});

test('Register for the live event goes through the engine, and the numbers agree with /api/event', async () => {
  const before = (await call('anon', 'GET', '/api/event')).body.venue.taken;
  const r = await call('sam', 'POST', '/api/events/kubekon-2026/rsvp');
  assert.equal(r.status, 200);
  assert.ok(['admitted', 'waiting'].includes(r.body.me.status));
  const after = (await call('sam', 'GET', '/api/event')).body;
  assert.equal(after.venue.taken, before + 1);
  assert.equal(after.me.status, r.body.me.status);
  assert.equal(r.body.going, after.venue.taken);
});

test('my events: one next session per event, in that event, never merged', async () => {
  await call('sam', 'POST', '/api/events/cn-portland-dec-2026/rsvp');
  const { body } = await call('sam', 'GET', '/api/events/mine');
  assert.deepEqual(body.map((e) => e.slug), ['kubekon-2026', 'cn-portland-dec-2026']);
  for (const e of body) {
    assert.ok(e.next, `${e.slug} has a next session`);
    assert.ok(e.next.id.startsWith(`${e.slug}-`), 'the next session belongs to its own event');
    assert.ok(EVENTS.find((x) => x.slug === e.slug).sessions.some((s) => s.id === e.next.id));
  }
  assert.equal(body[0].status, 'live');
  assert.equal(body[1].status, 'upcoming');
  assert.ok(body[1].daysUntil > 20);
  assert.equal((await call('anon', 'GET', '/api/events/mine')).status, 401);
  await call('sam', 'DELETE', '/api/events/cn-portland-dec-2026/rsvp');
});

test('overlapping dates in another city: 409 with a warning, then force', async () => {
  const meetup = EVENTS.find((e) => e.slug === 'cn-portland-dec-2026');
  const saved = { start: meetup.start, end: meetup.end };
  Object.assign(meetup, { start: '2026-11-10T17:30:00-08:00', end: '2026-11-10T21:00:00-08:00' }); // during KubeKon
  try {
    const r = await call('sam', 'POST', '/api/events/cn-portland-dec-2026/rsvp'); // sam is registered for KubeKon
    assert.equal(r.status, 409);
    assert.equal(r.body.overlap.slug, 'kubekon-2026');
    assert.match(r.body.error, /overlaps KubeKon 2026 in Salt Lake City/);
    assert.equal((await call('sam', 'GET', '/api/events/cn-portland-dec-2026')).body.me, null, 'nothing was registered');
    const forced = await call('sam', 'POST', '/api/events/cn-portland-dec-2026/rsvp', { force: true });
    assert.equal(forced.status, 200);
    assert.deepEqual(forced.body.me, { status: 'going' });
  } finally {
    Object.assign(meetup, saved);
    await call('sam', 'DELETE', '/api/events/cn-portland-dec-2026/rsvp');
  }
});

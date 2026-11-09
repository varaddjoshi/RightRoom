// End to end over HTTP and live events: the four flows from docs/journey-map.md on the in-memory server.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.DEMO_PASSWORD;
const { app } = require('../server');
const { listen } = require('../scripts/loadtest');

let base, server;
const streams = [];
test.after(() => { for (const s of streams) s.close(); server.closeAllConnections?.(); server.close(); });

const jar = {};
async function call(who, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie();
  if (set.length) jar[who] = set.map((c) => c.split(';')[0]).join('; ');
  const data = await r.json().catch(() => null);
  assert.ok(r.ok, `${who} ${method} ${path} -> ${r.status} ${JSON.stringify(data)}`);
  return data;
}
async function live(who, space) {
  const s = listen(base, jar[who], space);
  streams.push(s);
  await s.ready;
  return s;
}
const SLO1_MS = 10000;

test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); });
  for (const u of ['sam', 'leo', 'dana']) await call(u, 'POST', '/api/login', { handle: u, password: 'rightroom-demo' });
  await call('dana', 'POST', '/api/sim/reset');
});

test('attendee: register, queue for a full room, get an offer live, claim, check in, leave', async () => {
  const ev = await call('sam', 'POST', '/api/event/register');
  assert.ok(ev, 'registered');
  const before = await call('sam', 'GET', '/api/spaces/204');
  assert.equal(before.status, 'full');
  const samLive = await live('sam', '204');
  const q = await call('sam', 'POST', '/api/spaces/204/queue');
  assert.equal(q.position, 1);

  // Release lowers the count itself (someone left at the back right) and offers that seat.
  const sentAt = Date.now();
  await call('leo', 'POST', '/api/staff/spaces/204/release', { n: 1, zone: 'back-right' });
  const offer = await samLive.waitFor((e) => e.type === 'offer' && e.data.space === '204', SLO1_MS);
  assert.ok(offer, 'offer reached Sam over the live stream');
  assert.ok(offer.at - sentAt < SLO1_MS, `SLO 1: offer in ${offer.at - sentAt} ms`);
  assert.equal(offer.data.zone, 'back-right');

  const claimed = await call('sam', 'POST', `/api/offers/${offer.data.offer}/claim`);
  assert.match(JSON.stringify(claimed), /"code":"[A-Z0-9]{4}"/);
  const code = JSON.stringify(claimed).match(/"code":"([A-Z0-9]{4})"/)[1];
  assert.ok(JSON.stringify(await call('leo', 'GET', '/api/staff/spaces/204')).includes(code), 'staff see the claim code');

  await call('sam', 'POST', '/api/spaces/204/checkin', { zone: 'back-right', k: require('../src/presence').roomKey('204') });
  assert.equal((await call('sam', 'GET', '/api/spaces/204')).taken, 50);
  await call('sam', 'POST', '/api/spaces/204/leave');
  assert.equal((await call('sam', 'GET', '/api/spaces/204')).taken, 49, 'leaving frees the seat and nobody is waiting');
});

test('door staff: with the console open, reaching capacity asks staff to confirm Full', async () => {
  await call('leo', 'POST', '/api/staff/spaces/210/console', { action: 'open' });
  const leoLive = await live('leo', '210');
  const room = await call('leo', 'GET', '/api/spaces/210');
  await call('leo', 'POST', '/api/sim/checkins', { space: '210', n: room.capacity - room.taken });
  const confirm = await leoLive.waitFor((e) => e.type === 'confirm' && e.data.space === '210', SLO1_MS);
  assert.ok(confirm, 'confirm prompt pushed to the console');
  assert.equal(confirm.data.seconds, 30);
});

test('organiser: change capacity and post an urgent announcement that reaches phones live', async () => {
  const updated = await call('dana', 'PUT', '/api/staff/spaces/118', { capacity: 60 });
  assert.equal(updated.capacity, 60);
  const floors = JSON.stringify(await call('dana', 'GET', '/api/floors'));
  assert.match(floors, /"id":"118"[^}]*"capacity":60/);
  const samLive = await live('sam', '*');
  await call('dana', 'POST', '/api/announcements', { text: 'West lift is out of service.', floor: 2, urgency: 'urgent' });
  const a = await samLive.waitFor((e) => e.type === 'announcement' && e.data.urgency === 'urgent', SLO1_MS);
  assert.ok(a, 'announcement pushed live');
});

test('shared and demo: 50 people for 5 seats gives exactly 5 winners, and the screens load', async () => {
  const r = await call('leo', 'POST', '/api/sim/rush');
  assert.deepEqual([r.people, r.seats, r.winners], [50, 5, 5]);
  for (const p of ['/login', '/sessions', '/r/204', '/r/204/in', '/staff/room/204', '/staff/setup', '/screen/204', '/sim']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
});

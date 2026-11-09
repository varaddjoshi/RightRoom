const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');
const { roomKey, verify } = require('../src/presence');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

const DAY = 86_400_000;
async function login(handle) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, password: process.env.DEMO_PASSWORD || 'rightroom-demo' }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const checkin = (cookie, room, body) => fetch(`${base}/api/spaces/${room}/checkin`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

test('keys are per room and per day; today and yesterday verify, older does not', () => {
  const now = Date.now();
  assert.ok(verify('204', roomKey('204', now), now));
  assert.ok(!verify('210', roomKey('204', now), now));
  assert.ok(verify('204', roomKey('204', now - DAY), now));
  assert.ok(!verify('204', roomKey('204', now - 2 * DAY), now));
  assert.ok(!verify('204', 'short', now) && !verify('204', undefined, now));
});

test('check-in needs the in-room code key', async () => {
  const sam = await login('sam');
  const none = await checkin(sam, '210', { zone: 'front-left' });
  assert.equal(none.status, 403);
  assert.deepEqual(await none.json(), { error: 'Scan the code inside the room to check in.', needScan: true });
  assert.equal((await checkin(sam, '210', { zone: 'front-left', k: roomKey('204') })).status, 403, "another room's key");
  const ok = await checkin(sam, '210', { zone: 'front-left', k: roomKey('210') });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).checkedIn, true);
});

test('staff can fetch a room key for scripts; attendees cannot', async () => {
  assert.equal((await fetch(`${base}/api/staff/spaces/210/presence-key`, { headers: { cookie: await login('sam') } })).status, 403);
  const r = await (await fetch(`${base}/api/staff/spaces/210/presence-key`, { headers: { cookie: await login('leo') } })).json();
  assert.equal(r.k, roomKey('210'));
});

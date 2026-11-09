// The HTTP load test (scripts/loadtest.js) against the app in this process, so CI checks the same path a phone uses.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL; // always the in-memory store here
const { app, store } = require('../server');
const { run } = require('../scripts/loadtest');

test('over HTTP: 50 people try for 5 seats, exactly 5 win, and Full is pushed', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const r = await run({ url: `http://127.0.0.1:${port}`, log: () => {} });
    assert.ok(r.ok, r.checks.filter((c) => !c.ok).map((c) => c.what).join('; '));
    assert.ok(r.requests >= 50 * 5, 'every guest tried every offer');
  } finally {
    server.closeAllConnections();
    server.close();
  }
  // The test room and its guest accounts are gone again.
  assert.equal(store.db.spaces.has('loadtest'), false);
  assert.equal([...store.db.users.keys()].some((h) => h.startsWith('guest-')), false);
});

test('the load test room stays out of room lists, and recreating it removes its guests', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, cookie) => {
    const res = await fetch(base + path, { method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
  };
  try {
    const staff = (await call('POST', '/api/login', { handle: 'leo', password: 'rightroom-demo' })).cookie;
    assert.equal((await call('POST', '/api/sim/loadtest-room', { seats: 1 }, staff)).status, 200);
    const guest = (await call('POST', '/api/guest')).cookie;
    assert.equal((await call('POST', '/api/spaces/loadtest/queue', null, guest)).status, 200);
    assert.ok(!(await call('GET', '/api/sessions')).data.some((s) => s.id === 'loadtest'));
    assert.ok(!(await call('GET', '/api/floors')).data.flatMap((f) => f.rooms).some((r) => r.id === 'loadtest'));
    assert.equal((await call('POST', '/api/spaces/loadtest/queue', null, (await call('POST', '/api/guest')).cookie)).status, 200);
    await call('POST', '/api/sim/loadtest-room', { seats: 1 }, staff); // recreate
    assert.equal([...store.db.users.keys()].some((h) => h.startsWith('guest-')), false);
    assert.equal((await call('DELETE', '/api/sim/loadtest-room', null, staff)).data.removed, true);
    assert.equal((await call('POST', '/api/sim/loadtest-room', {}, (await call('POST', '/api/guest')).cookie)).status, 403);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

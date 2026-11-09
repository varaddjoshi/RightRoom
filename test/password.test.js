// PUT /api/me/password: change your own password, giving the current one.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL;
const { app } = require('../server');

test('a signed-in user changes their own password; the old one stops working', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, cookie = '') => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
  };
  try {
    const host = (await call('POST', '/api/login', { handle: 'host', password: 'rightroom-demo' })).cookie;
    assert.equal((await call('PUT', '/api/me/password', { current: 'wrong-one', password: 'changed-pass-123' }, host)).status, 403);
    assert.equal((await call('PUT', '/api/me/password', { current: 'rightroom-demo', password: 'short' }, host)).status, 400);
    assert.equal((await call('PUT', '/api/me/password', { current: 'rightroom-demo', password: 'changed-pass-123' })).status, 401);
    assert.equal((await call('PUT', '/api/me/password', { current: 'rightroom-demo', password: 'changed-pass-123' }, host)).data.changed, true);
    assert.equal((await call('POST', '/api/login', { handle: 'host', password: 'rightroom-demo' })).status, 401);
    assert.equal((await call('POST', '/api/login', { handle: 'host', password: 'changed-pass-123' })).status, 200);
    const guest = (await call('POST', '/api/guest')).cookie;
    assert.equal((await call('PUT', '/api/me/password', { current: '', password: 'changed-pass-123' }, guest)).status, 400);
  } finally { server.closeAllConnections(); server.close(); }
});

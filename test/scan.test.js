const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptCode } = require('../public/scan.js');

const origin = 'https://rightroom.test';

test('accepts our own door, room and staff links', () => {
  assert.equal(acceptCode('https://rightroom.test/r/204', origin), '/r/204');
  assert.equal(acceptCode('https://rightroom.test/r/204/in?x=1#a', origin), '/r/204/in?x=1#a');
  assert.equal(acceptCode('/staff/room/204', origin), '/staff/room/204');
  assert.equal(acceptCode('  https://rightroom.test/r/venue  ', origin), '/r/venue');
});

test('rejects other sites, other schemes and other paths', () => {
  for (const bad of ['https://evil.test/r/204', '//evil.test/r/204', '/\\evil.test/r/204', 'javascript:alert(1)',
    'https://rightroom.test/login', 'https://rightroom.test/api/me', 'https://rightroom.test/rx/204', '', null, 'not a url at all']) {
    assert.equal(acceptCode(bad, origin), null, String(bad));
  }
});

test('/scan page is served', async () => {
  const { app } = require('../server');
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/scan`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /scan\.js/);
  } finally { server.close(); }
});

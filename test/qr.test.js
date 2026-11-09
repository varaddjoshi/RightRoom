const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');

delete process.env.DEMO_PASSWORD;
process.env.PUBLIC_URL = 'https://pantheon.example/';
const { app } = require('../server');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

async function login(handle) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, password: 'rightroom-demo' }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const get = (p, cookie) => fetch(base + p, { headers: cookie ? { cookie } : {} });
// The route encodes the URL with the same library and options, so equal SVGs mean the code holds that URL.
const { roomKey } = require('../src/presence');
const svgFor = (url) => QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });

test('door and in-room codes are public SVGs that point at PUBLIC_URL', async () => {
  for (const [q, path] of [['', '/r/204'], ['?kind=door', '/r/204'], [`?kind=in`, `/r/204/in?k=${roomKey('204')}`]]) {
    const r = await get(`/qr/204.svg${q}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
    assert.equal(await r.text(), await svgFor(`https://pantheon.example${path}`));
  }
  assert.equal(await (await get('/qr/venue.svg')).text(), await svgFor(`https://pantheon.example/r/venue?k=${roomKey('venue')}`));
});

test('staff codes need a staff login', async () => {
  assert.equal((await get('/qr/204.svg?kind=staff')).status, 401);
  assert.equal((await get('/qr/204.svg?kind=staff', await login('sam'))).status, 403);
  const r = await get('/qr/204.svg?kind=staff', await login('leo'));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), await svgFor('https://pantheon.example/staff/room/204'));
});

test('bad room, kind or file name is rejected', async () => {
  assert.equal((await get('/qr/999.svg')).status, 404);
  assert.equal((await get('/qr/204.png')).status, 404);
  assert.equal((await get('/qr/204.svg?kind=admin')).status, 400);
  assert.equal((await get('/qr/venue.svg?kind=in')).status, 400);
});

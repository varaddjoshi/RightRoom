// Browser monitoring: off without a token, correct settings with one, SDK file served, and public/rum.js
// does the right thing in a (fake) browser and never throws. No Dash0, no Elasticsearch, no real browser needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.ELASTICSEARCH_URL; // in-memory store only
delete process.env.DASH0_BROWSER_TOKEN;
delete process.env.DASH0_BROWSER_ENDPOINT;
const { rumConfig, defaultEndpoint, SDK_FILE } = require('../src/rum');
const { app } = require('../server');

const GRPC = 'https://ingress.example.dash0.com:4317';

test('no token means monitoring is off, even with an endpoint', () => {
  assert.deepEqual(rumConfig({}), { enabled: false });
  assert.deepEqual(rumConfig({ DASH0_OTLP_ENDPOINT: GRPC }), { enabled: false });
  assert.deepEqual(rumConfig({ DASH0_BROWSER_TOKEN: '   ', DASH0_OTLP_ENDPOINT: GRPC }), { enabled: false });
});

test('with a token the endpoint is the server endpoint host over HTTPS, without the gRPC port', () => {
  const c = rumConfig({ DASH0_BROWSER_TOKEN: ' auth_abc ', DASH0_OTLP_ENDPOINT: GRPC, NODE_ENV: 'production', APP_VERSION: 'abc1234' });
  assert.deepEqual(c, {
    enabled: true,
    serviceName: 'rightroom-web',
    serviceVersion: 'abc1234',
    environment: 'production',
    endpoint: { url: 'https://ingress.example.dash0.com', authToken: 'auth_abc' },
  });
});

test('an explicit DASH0_BROWSER_ENDPOINT wins and loses its trailing slash', () => {
  const c = rumConfig({ DASH0_BROWSER_TOKEN: 'auth_abc', DASH0_BROWSER_ENDPOINT: 'http://localhost:4399/', DASH0_OTLP_ENDPOINT: GRPC });
  assert.equal(c.endpoint.url, 'http://localhost:4399');
});

test('a token with nowhere to send to stays off instead of guessing', () => {
  assert.deepEqual(rumConfig({ DASH0_BROWSER_TOKEN: 'auth_abc' }), { enabled: false });
  assert.deepEqual(rumConfig({ DASH0_BROWSER_TOKEN: 'auth_abc', DASH0_OTLP_ENDPOINT: 'not a url' }), { enabled: false });
  assert.equal(defaultEndpoint(undefined), '');
});

async function withServer(fn) {
  const server = app.listen(0);
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); server.close(); }
}

test('the real app: /api/rum-config is public, uncached, and follows the environment', async () => {
  await withServer(async (base) => {
    const off = await fetch(`${base}/api/rum-config`);
    assert.equal(off.status, 200);
    assert.equal(off.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await off.json(), { enabled: false });

    process.env.DASH0_BROWSER_TOKEN = 'auth_test_token';
    process.env.DASH0_OTLP_ENDPOINT = GRPC;
    try {
      const on = await (await fetch(`${base}/api/rum-config`)).json();
      assert.equal(on.enabled, true);
      assert.equal(on.endpoint.url, 'https://ingress.example.dash0.com');
      assert.equal(on.endpoint.authToken, 'auth_test_token');
    } finally {
      delete process.env.DASH0_BROWSER_TOKEN;
      delete process.env.DASH0_OTLP_ENDPOINT;
    }
    assert.deepEqual(await (await fetch(`${base}/api/rum-config`)).json(), { enabled: false }, 'and goes off again');
  });
});

test('the real app serves the Dash0 Web SDK file from its own host', async () => {
  assert.ok(fs.existsSync(SDK_FILE), 'run npm ci: @dash0/sdk-web is missing');
  await withServer(async (base) => {
    const res = await fetch(`${base}/vendor/dash0-sdk-web.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.ok(body.length > 50_000, 'the whole file');
    assert.match(body, /Dash0 Web SDK/);
  });
});

// Runs public/rum.js in a fake browser. `fetchImpl` stands in for fetch.
async function runRum(fetchImpl) {
  const appended = [];
  const calls = [];
  const context = {
    window: {},
    document: { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } },
    fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
  };
  vm.createContext(context);
  await vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'rum.js'), 'utf8'), context);
  const plain = (x) => JSON.parse(JSON.stringify(x)); // drop the fake browser's own object prototypes
  return { window: context.window, appended: plain(appended), calls: plain(calls) };
}
const json = (body, ok = true) => async () => ({ ok, json: async () => body });

test('public/rum.js queues init and loads the SDK when monitoring is on', async () => {
  const cfg = { enabled: true, serviceName: 'rightroom-web', serviceVersion: 'dev', environment: 'test', endpoint: { url: 'https://x.example', authToken: 'auth_t' } };
  const { window, appended, calls } = await runRum(json(cfg));
  assert.equal(calls[0][0], '/api/rum-config');
  assert.equal(calls[0][1].credentials, 'omit', 'the settings request carries no cookies');
  const queued = JSON.parse(JSON.stringify(Array.from(window.dash0._q, (a) => Array.from(a))));
  assert.deepEqual(queued, [['init', { serviceName: 'rightroom-web', serviceVersion: 'dev', environment: 'test', endpoint: { url: 'https://x.example', authToken: 'auth_t' } }]]);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, '/vendor/dash0-sdk-web.js');
});

test('public/rum.js does nothing when monitoring is off, and never throws', async () => {
  for (const f of [json({ enabled: false }), json({}, false), async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })]) {
    const { window, appended } = await runRum(f);
    assert.equal(window.dash0, undefined);
    assert.equal(appended.length, 0);
  }
});

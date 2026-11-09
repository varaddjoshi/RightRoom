// The demo clock: GET /api/clock tells screens about it, public/demo-clock.js labels it, and the check-in QR key does
// NOT follow it (a demo clock restarts at the same moment every time, so a key from it would never rotate).
// DEMO_CLOCK must be set before anything loads src/clock.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

delete process.env.ELASTICSEARCH_URL; // in-memory store only
process.env.DEMO_CLOCK = '2026-11-10T11:45:00-07:00';
const { app } = require('../server');
const presence = require('../src/presence');

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try { resolve(await fn(`http://127.0.0.1:${server.address().port}`)); } catch (e) { reject(e); } finally { server.close(); }
    });
  });
}

test('GET /api/clock says the clock is a demo clock, and what time it is', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/clock`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.demo, true);
    const drift = Date.parse(body.now) - Date.parse('2026-11-10T18:45:00Z');
    assert.ok(drift >= 0 && drift < 60_000, `demo time starts at 11:45 MST and ticks forward (drift ${drift} ms)`);
    assert.deepEqual(Object.keys(body).sort(), ['demo', 'now'], 'nothing else is exposed');
  });
});

test('without DEMO_CLOCK the same endpoint says demo:false', () => {
  const out = execFileSync(process.execPath, ['-e', `
    delete process.env.DEMO_CLOCK;
    const express = require('express');
    const app = express(); app.use(require('./src/clockinfo').router());
    const s = app.listen(0, async () => {
      const b = await (await fetch('http://127.0.0.1:' + s.address().port + '/api/clock')).json();
      console.log(JSON.stringify({ demo: b.demo, near: Math.abs(Date.parse(b.now) - Date.now()) < 5000 }));
      s.close();
    });
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, DEMO_CLOCK: '' } });
  assert.deepEqual(JSON.parse(out.trim()), { demo: false, near: true });
});

test('the check-in QR key follows the REAL day, not the demo clock', () => {
  assert.equal(presence.roomKey('204'), presence.roomKey('204', Date.now()));
  assert.notEqual(presence.roomKey('204'), presence.roomKey('204', Date.parse('2026-11-10T18:45:00Z')), 'demo day is not used');
  assert.equal(presence.verify('204', presence.roomKey('204')), true);
  assert.equal(presence.verify('204', presence.roomKey('204', Date.now() - 86_400_000)), true, 'yesterday still works');
});

// Runs public/demo-clock.js in a fake browser. `fetchImpl` stands in for fetch.
async function runLabel(fetchImpl) {
  const appended = [];
  const intervals = [];
  const stored = {};
  const context = {
    document: {
      createElement: (tag) => ({ tag, style: {}, children: [], listeners: {}, setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
        appendChild(c) { this.children.push(c); }, addEventListener(t, fn) { this.listeners[t] = fn; }, focus() {} }),
      body: { appendChild: (el) => appended.push(el) },
    },
    localStorage: { getItem: () => null, setItem: (k, v) => { stored[k] = v; } },
    fetch: (...args) => fetchImpl(...args),
    Intl, Date, setInterval: (fn, ms) => { intervals.push(ms); return 1; },
  };
  vm.createContext(context);
  await vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'demo-clock.js'), 'utf8'), context);
  return { appended, intervals, stored };
}
const json = (body, ok = true) => async () => ({ ok, json: async () => body });

test('public/demo-clock.js shows a collapsed "Demo" chip that opens to the stand-in time, in MST, only when the server says demo', async () => {
  const { appended, intervals, stored } = await runLabel(json({ demo: true, now: '2026-11-10T18:45:00.000Z' }));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'rr-demo-clock');
  const btn = appended[0].children.find((c) => c.tag === 'button');
  const more = appended[0].children.find((c) => c.tag === 'p');
  assert.equal(btn.textContent, 'Demo');
  assert.equal(btn['aria-expanded'], 'false', 'collapsed by default');
  assert.equal(more.hidden, true);
  assert.match(more.textContent, /^Stand-in time Tue,? 11:4\d AM\./);
  btn.listeners.click();
  assert.equal(btn['aria-expanded'], 'true');
  assert.equal(more.hidden, false);
  assert.equal(stored['rr-demo-clock-open'], '1', 'open state is remembered');
  btn.listeners.click();
  assert.equal(more.hidden, true);
  assert.deepEqual(intervals, [30_000], 'the stand-in time keeps ticking');
});

test('public/demo-clock.js does nothing on a normal server, and never throws', async () => {
  for (const f of [json({ demo: false, now: new Date().toISOString() }), json({}, false), async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })]) {
    const { appended } = await runLabel(f);
    assert.equal(appended.length, 0);
  }
});

test('public/app.js loads both /rum.js and /demo-clock.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').split('\n').slice(0, 6).join('\n');
  assert.match(src, /\/rum\.js/);
  assert.match(src, /\/demo-clock\.js/);
});

#!/usr/bin/env node
// Load test for the seat rules over real HTTP (docs/architecture.md, "The rules that must never break").
//
// 50 guests queue at once for a 5-seat test room, then every guest tries to claim every offer at once. Passes only if
// exactly 5 claims win, no offer or person wins twice, the room shows taken == capacity, and a Full status reaches a
// live stream subscriber. With --pass-on it also proves an unclaimed offer passes to the next person after 60 seconds
// and that the offer is pushed to them. It uses its own room (/api/sim/loadtest-room), never the real ones, and
// removes it afterwards.
//
//   node scripts/loadtest.js [--url http://localhost:3000] [--people 50] [--seats 5] [--pass-on] [--live] [--concurrency 64]
//
// Any URL other than localhost needs --live (or RR_LOADTEST_LIVE=1), so nobody floods the public demo by accident.
//
// Signs in as a staff user: RR_USER (default dana) and RR_PASSWORD (default DEMO_PASSWORD, then "rightroom-demo").
// Exit code 0 when every check passes, 1 otherwise.

const ROOM = 'loadtest';

function parseArgs(argv) {
  const o = { url: process.env.RR_URL || 'http://localhost:3000', people: 50, seats: 5, passOn: false, live: process.env.RR_LOADTEST_LIVE === '1', concurrency: 64 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (a === '--people') o.people = Number(argv[++i]);
    else if (a === '--seats') o.seats = Number(argv[++i]);
    else if (a === '--pass-on') o.passOn = true;
    else if (a === '--live') o.live = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

// At most `max` requests in flight. Claims still race (64 at once is plenty for 5 seats), but the client never opens
// more connections than a laptop's accept queue takes: macOS resets past 128 when client and server share a process.
function limiter(max) {
  let active = 0;
  const waiting = [];
  return async (fn) => {
    if (active < max) active++;
    else await new Promise((r) => waiting.push(r)); // the slot is handed over, so `active` stays the same
    try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}

// One person: a cookie jar and timed JSON requests.
function client(base, timings, limit = (fn) => fn()) {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const req = (method, path, body) => limit(async () => {
    const t0 = performance.now();
    const res = await fetch(base + path, {
      method,
      headers: { cookie: cookie(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const data = await res.json().catch(() => null);
    timings.push(performance.now() - t0);
    return { status: res.status, data };
  });
  return { req, cookie };
}

// Server-sent events from /api/stream, as the phones get them.
function listen(base, cookie, space) {
  const events = [];
  const waiters = [];
  const ctrl = new AbortController();
  const opened = Date.now();
  let droppedAfter = null; // seconds, when the server or a proxy closed the stream before we did
  const ready = fetch(`${base}/api/stream?space=${encodeURIComponent(space)}`, { headers: { cookie, accept: 'text/event-stream' }, signal: ctrl.signal })
    .then(async (res) => {
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const type = /^event: (.+)$/m.exec(chunk)?.[1];
              const data = /^data: (.+)$/m.exec(chunk)?.[1];
              if (!type || !data) continue;
              const ev = { type, data: JSON.parse(data), at: Date.now() };
              events.push(ev);
              for (const w of [...waiters]) if (w.match(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
            }
          }
        } catch { /* aborted at the end */ }
        // Closed from the other end: phones would reconnect and could miss events in the gap. Fail the waits now.
        if (!ctrl.signal.aborted) {
          droppedAfter = Math.round((Date.now() - opened) / 1000);
          for (const w of waiters.splice(0)) w.resolve(null);
        }
      })();
    });
  function waitFor(match, ms) {
    const seen = events.find(match);
    if (seen || droppedAfter !== null) return Promise.resolve(seen || null);
    return new Promise((resolve) => {
      const w = { match, resolve };
      waiters.push(w);
      // Not unref'd: the wait itself keeps the process alive until it is answered or times out.
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
    });
  }
  return { ready, events, waitFor, dropped: () => droppedAfter, close: () => ctrl.abort() };
}

function pct(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const isLocal = (u) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(u).hostname);

async function run({ url, people = 50, seats = 5, passOn = false, live = false, concurrency = 64, user = process.env.RR_USER || 'dana', password = process.env.RR_PASSWORD || process.env.DEMO_PASSWORD || 'rightroom-demo', log = console.log } = {}) {
  const base = url.replace(/\/+$/, '');
  if (!isLocal(base) && !live) throw new Error(`${base} is not local. Add --live (or RR_LOADTEST_LIVE=1) to load test it on purpose.`);
  const timings = [];
  const checks = [];
  const check = (ok, what) => { checks.push({ ok: !!ok, what }); log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };
  const limit = limiter(Math.max(1, concurrency));
  const staff = client(base, timings, limit);

  const login = await staff.req('POST', '/api/login', { handle: user, password });
  if (login.status !== 200 || !['staff', 'organiser'].includes(login.data?.role)) {
    throw new Error(`Couldn't sign in as staff user "${user}" (HTTP ${login.status}). Set RR_USER and RR_PASSWORD.`);
  }
  const started = Date.now();
  try {
    // Phase 1: 50 people, 5 seats.
    const made = await staff.req('POST', '/api/sim/loadtest-room', { seats });
    if (made.status !== 200) throw new Error(`Couldn't create the load test room (HTTP ${made.status}: ${made.data?.error})`);
    const watch = listen(base, staff.cookie(), ROOM);
    await watch.ready;

    const crowd = Array.from({ length: people }, () => client(base, timings, limit));
    const guests = await Promise.all(crowd.map((c) => c.req('POST', '/api/guest')));
    check(guests.every((g) => g.status === 200), `${people} guests signed in`);

    const joined = await Promise.all(crowd.map((c) => c.req('POST', `/api/spaces/${ROOM}/queue`)));
    check(joined.every((j) => j.status === 200), `${people} queued at the same time`);

    const views = await Promise.all(crowd.map((c) => c.req('GET', `/api/spaces/${ROOM}`)));
    const offers = views.map((v) => v.data?.me?.queue?.offer?.id).filter(Boolean);
    check(offers.length === seats && new Set(offers).size === seats, `exactly ${seats} offers made, one per person (got ${offers.length})`);

    // Everyone tries every offer at once: 50 x 5 claims.
    const tries = crowd.flatMap((c, i) => offers.map((o) => c.req('POST', `/api/offers/${o}/claim`).then((r) => ({ who: i, offer: o, ...r }))));
    const results = await Promise.all(tries);
    const wins = results.filter((r) => r.status === 200);
    check(wins.length === seats, `exactly ${seats} of ${results.length} claims won (got ${wins.length})`);
    check(new Set(wins.map((w) => w.offer)).size === wins.length, 'no offer was claimed twice');
    check(new Set(wins.map((w) => w.who)).size === wins.length, 'nobody got two seats');
    check(results.every((r) => r.status === 200 || r.status === 404 || r.status === 409), 'every losing claim was refused cleanly (404/409, no 5xx)');

    const room = (await staff.req('GET', `/api/spaces/${ROOM}`)).data;
    check(room?.taken === seats && room?.free === 0, `room shows taken ${room?.taken} of ${room?.capacity}, free ${room?.free}`);
    const full = await watch.waitFor((e) => e.type === 'status' && e.data.space === ROOM && e.data.status === 'full', 5000);
    check(full, 'a Full status was pushed to a live stream subscriber');
    watch.close();

    // Phase 2 (--pass-on): an unclaimed offer passes to the next person after 60 seconds, pushed to their phone.
    if (passOn) {
      await staff.req('POST', '/api/sim/loadtest-room', { seats: 1 });
      const [a, b] = [client(base, timings, limit), client(base, timings, limit)];
      await a.req('POST', '/api/guest');
      await b.req('POST', '/api/guest');
      const bHandle = (await b.req('GET', '/api/me')).data?.handle;
      const bPhone = listen(base, b.cookie(), ROOM);
      await bPhone.ready;
      await a.req('POST', `/api/spaces/${ROOM}/queue`);
      const aOffer = (await a.req('GET', `/api/spaces/${ROOM}`)).data?.me?.queue?.offer;
      await b.req('POST', `/api/spaces/${ROOM}/queue`);
      check(aOffer?.id, `first person offered the seat (${aOffer?.secondsLeft}s to claim); second waits`);
      log('      waiting for the offer to run out (about 60 seconds)...');
      const t0 = Date.now();
      const got = await bPhone.waitFor((e) => e.type === 'offer' && e.data.space === ROOM, 75_000);
      const after = Math.round((Date.now() - t0) / 1000);
      check(bPhone.dropped() === null, bPhone.dropped() === null ? 'the live stream stayed open the whole minute' : `the live stream was closed by the server or a proxy after ${bPhone.dropped()}s`);
      check(got && after >= 55 && after <= 70, `the unclaimed offer passed to the next person after ${after}s and was pushed to them${bHandle ? ` (${bHandle})` : ''}`);
      bPhone.close();
    }
  } finally {
    await staff.req('DELETE', '/api/sim/loadtest-room').catch(() => {});
  }

  const failed = checks.filter((c) => !c.ok);
  log(`\n${checks.length - failed.length}/${checks.length} checks passed against ${base} in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  log(`${timings.length} requests: p50 ${pct(timings, 50).toFixed(0)} ms, p95 ${pct(timings, 95).toFixed(0)} ms, max ${pct(timings, 100).toFixed(0)} ms.`);
  return { ok: failed.length === 0, checks, requests: timings.length };
}

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help) { console.log('node scripts/loadtest.js [--url URL] [--people 50] [--seats 5] [--pass-on] [--live] [--concurrency 64]'); process.exit(0); }
  run(opts).then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(`Load test could not run: ${e.message}`); process.exit(1); });
}

module.exports = { run };

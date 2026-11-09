// Thin HTTP layer over the engine. Input is validated here (the trust boundary); rules live in src/engine.js.
const express = require('express');
const auth = require('../auth');
const stream = require('../stream');
const { topTerms } = require('../topics');
const { ZONES } = require('../mock/seed');

function api({ store, engine }) {
  const r = express.Router();
  const db = () => store.db;
  const { requireRole } = auth;

  // Runs a handler and maps thrown {status, message} errors to JSON; anything else is a 500 without details.
  const h = (fn) => (req, res) => {
    try { res.json(fn(req, res)); }
    catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' });
    }
  };
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const signedIn = (req) => req.user || fail('Sign in first.', 401);
  const int = (v, min, max, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const zone = (z) => (z == null || z === '' ? null : ZONES.includes(z) ? z : fail('Unknown zone.'));
  const sid = (req) => (db().spaces.has(req.params.id) ? req.params.id : fail('No such room.', 404));
  const bodySpace = (req) => sid({ params: { id: String(req.body?.space) } });
  const text = (v, max, name) => {
    const s = String(v ?? '').trim();
    if (!s || s.length > max) fail(`${name} must be 1 to ${max} characters.`);
    return s;
  };

  // Auth (A1)
  r.post('/signup', h((req, res) => { const u = auth.signup(db(), req.body?.handle, req.body?.password); auth.setSession(res, u); return auth.publicUser(u); }));
  r.post('/login', h((req, res) => { const u = auth.login(db(), req.body?.handle, req.body?.password); auth.setSession(res, u); return auth.publicUser(u); }));
  r.post('/logout', h((req, res) => { auth.clearSession(res); return { ok: true }; }));
  r.post('/guest', h((req, res) => { const u = req.user || auth.guest(db()); auth.setSession(res, u); return auth.publicUser(u); }));

  // Profile (A2)
  r.get('/me', h((req) => ({ ...auth.publicUser(signedIn(req)), venue: engine.myVenue(req.user.handle) })));
  r.put('/me', h((req) => {
    const u = signedIn(req);
    const interests = req.body?.interests ?? u.interests;
    const needs = req.body?.needs ?? u.needs;
    if (!Array.isArray(interests) || interests.length > 12 || interests.some((t) => typeof t !== 'string' || !/^[a-z0-9-]{2,24}$/.test(t))) fail('Interests must be up to 12 short tags.');
    if (!Array.isArray(needs) || needs.some((n) => !auth.NEEDS.includes(n))) fail(`Needs can only be: ${auth.NEEDS.join(', ')}.`);
    Object.assign(u, { interests, needs });
    return auth.publicUser(u);
  }));

  // Venue (A3)
  r.get('/event', h((req) => ({ venue: engine.view(engine.space('venue')), me: req.user ? engine.myVenue(req.user.handle) : null })));
  r.post('/event/register', h((req) => {
    const u = signedIn(req);
    if (u.role === 'guest') fail('Create an account to register.', 403);
    return engine.register(u);
  }));

  // Schedule and floors (A4, S1, S2, D1)
  r.get('/sessions', h(() => [...db().spaces.values()].filter((s) => s.type === 'room' && !s.test).map((s) => ({ ...engine.view(s), wifi: engine.wifiMedian(s.id) }))));
  r.get('/floors', h((req) => engine.floors(req.user?.role, db().spaces.has(String(req.query.from)) ? String(req.query.from) : null)));

  // Room door and inside (A5, A6)
  r.get('/spaces/:id', h((req) => engine.roomForUser(sid(req), req.user?.handle)));
  r.post('/spaces/:id/queue', h((req) => engine.joinQueue(sid(req), signedIn(req), req.device)));
  r.delete('/spaces/:id/queue', h((req) => engine.leaveQueue(sid(req), signedIn(req).handle)));
  // Signed in: a suggestion plus that person's one hold. Signed out (D1 big screen): read-only, no hold (issue #23).
  r.get('/spaces/:id/redirect', h((req) => engine.redirect(sid(req), req.user || null)));
  r.post('/offers/:id/claim', h((req) => engine.claim(req.params.id, signedIn(req).handle, req.body?.version)));
  r.post('/spaces/:id/checkin', h((req) => engine.checkin(sid(req), signedIn(req), zone(req.body?.zone))));
  r.post('/spaces/:id/leave', h((req) => engine.leave(sid(req), signedIn(req).handle)));

  // Extras on A6: crowd-sourced Wi-Fi and comments (stored without a handle).
  r.post('/spaces/:id/wifi', h((req) => {
    signedIn(req);
    const reading = { space: sid(req), zone: zone(req.body?.zone), mbps: int(Math.round(req.body?.mbps), 0, 10_000, 'mbps'), ms: int(Math.round(req.body?.ms), 0, 60_000, 'ms'), at: Date.now() };
    db().wifi.push(reading);
    return { ...reading, median: engine.wifiMedian(reading.space) };
  }));
  r.get('/spaces/:id/comments', h((req) => {
    const id = sid(req);
    const shown = db().comments.filter((c) => !c.hidden);
    // shortcut: topics.js stands in for the Elasticsearch significant_text topics.
    const top = topTerms(shown.filter((c) => c.space === id).map((c) => c.text), shown.map((c) => c.text));
    return { topics: top.map((t) => t.term) };
  }));
  r.post('/spaces/:id/comments', h((req) => {
    signedIn(req);
    const c = { id: ++db().seq, space: sid(req), text: text(req.body?.text, 280, 'Comment'), at: Date.now(), hidden: false };
    db().comments.push(c);
    return { id: c.id, posted: true };
  }));

  // Door staff (S2). Organisers pass every staff check.
  r.get('/staff/spaces/:id', requireRole('staff'), h((req) => ({ ...engine.staffView(sid(req)), comments: db().comments.filter((c) => c.space === req.params.id).slice(-20) })));
  r.post('/staff/spaces/:id/console', requireRole('staff'), h((req) => engine.setConsole(sid(req), req.user.handle, req.body?.action === 'leave' ? 'leave' : 'open')));
  r.post('/staff/spaces/:id/count', requireRole('staff'), h((req) => engine.correct(sid(req), int(req.body?.delta, -500, 500, 'delta'))));
  r.post('/staff/spaces/:id/override', requireRole('staff'), h((req) => {
    const mode = ['full', 'not_full', 'clear'].includes(req.body?.mode) ? req.body.mode : fail('mode must be full, not_full or clear.');
    return engine.override(sid(req), mode);
  }));
  r.post('/staff/spaces/:id/release', requireRole('staff'), h((req) => engine.release(sid(req), int(req.body?.n, 1, 500, 'n'), zone(req.body?.zone))));
  r.post('/staff/spaces/:id/confirm', requireRole('staff'), h((req) => {
    const answer = req.body?.answer === 'not_yet' ? 'not_yet' : req.body?.answer === 'full' ? 'full' : fail('answer must be full or not_yet.');
    return engine.confirm(sid(req), answer, answer === 'not_yet' ? int(req.body?.n, 1, 500, 'n') : 0, zone(req.body?.zone));
  }));
  r.post('/staff/comments/:cid/hide', requireRole('staff'), h((req) => {
    const c = db().comments.find((x) => x.id === Number(req.params.cid)) || fail('No such comment.', 404);
    c.hidden = true;
    return { hidden: true };
  }));

  // Organiser (S1)
  r.put('/staff/spaces/:id', requireRole('organiser'), h((req) => {
    const sp = db().spaces.get(sid(req));
    if (req.body?.capacity !== undefined) sp.capacity = int(req.body.capacity, 1, 5000, 'capacity');
    if (req.body?.rule !== undefined) sp.rule = text(req.body.rule, 200, 'Rule');
    if (req.body?.accessZones !== undefined) {
      if (!Array.isArray(req.body.accessZones) || req.body.accessZones.some((z) => !ZONES.includes(z))) fail('accessZones must be zone names.');
      sp.accessZones = req.body.accessZones;
    }
    return engine.update(sp);
  }));
  r.get('/staff/interests', requireRole('organiser'), h(() => {
    const counts = {};
    for (const u of db().users.values()) for (const t of u.interests || []) counts[t] = (counts[t] || 0) + 1;
    // Groups under 5 are hidden (journey-map decision 10).
    return Object.entries(counts).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n }));
  }));

  // Announcements (A7, S1)
  r.get('/announcements', h(() => [...db().announcements].sort((a, b) => b.at - a.at)));
  r.post('/announcements', requireRole('organiser'), h((req) => {
    const floor = req.body?.floor == null || req.body.floor === '' ? null : int(req.body.floor, 0, 50, 'floor');
    const a = { id: ++db().seq, text: text(req.body?.text, 280, 'Message'), floor, urgency: req.body?.urgency === 'urgent' ? 'urgent' : 'info', at: Date.now() };
    db().announcements.push(a);
    stream.publish('announcement', a, { space: '*' });
    return a;
  }));

  // Live updates and SLO 1 acknowledgements
  r.get('/stream', (req, res) => {
    const space = req.query.space === '*' || db().spaces.has(String(req.query.space)) ? String(req.query.space) : '*';
    stream.subscribe(req, res, { space, handle: req.user?.handle });
  });
  r.post('/ack', h((req) => ({ delivery_ms: stream.ack(req.body?.event_id, undefined, req.user?.handle) })));

  // Simulator (D2). Everything it adds is a stand-in.
  r.post('/sim/checkins', requireRole('staff'), h((req) => {
    const id = bodySpace(req);
    if (engine.space(id).type !== 'room') fail('Simulator check-ins only work for rooms.');
    const n = int(req.body?.n ?? 10, 1, 500, 'n');
    const m = db().checkins.get(id);
    for (let i = 0; i < n; i++) m.set(`stand-in-sim-${++db().seq}`, { zone: ZONES[db().seq % 9], at: Date.now(), standIn: true });
    return engine.update(engine.space(id));
  }));
  r.post('/sim/queue', requireRole('staff'), h((req) => {
    const id = bodySpace(req);
    const n = int(req.body?.n ?? 5, 1, 200, 'n');
    for (let i = 0; i < n; i++) engine.joinQueue(id, { handle: `stand-in-q-${++db().seq}`, needs: [] }, null);
    return engine.staffView(id);
  }));
  r.post('/sim/rush', requireRole('staff'), h(() => rush(engine, db())));
  // Room for scripts/loadtest.js over real HTTP: separate from the real rooms and left out of /sessions, /floors and
  // redirects. POST recreates it empty with `seats` seats; DELETE removes it with its queue, offers and the guest
  // accounts that only queued for it.
  r.post('/sim/loadtest-room', requireRole('staff'), h((req) => {
    const seats = int(req.body?.seats ?? 5, 1, 50, 'seats');
    removeTestRoom(db(), LOADTEST_ROOM, { guests: true });
    addTestRoom(db(), LOADTEST_ROOM, seats);
    return engine.view(engine.space(LOADTEST_ROOM));
  }));
  r.delete('/sim/loadtest-room', requireRole('staff'), h(() => removeTestRoom(db(), LOADTEST_ROOM, { guests: true })));
  r.post('/sim/end-session', requireRole('staff'), h((req) => engine.endSession(bodySpace(req))));
  r.post('/sim/reset', requireRole('organiser'), h(() => { store.reset(); auth.ensureDemoUsers(store.db); return { reset: true }; }));

  return r;
}

// Load test in-process: 50 stand-ins queue for a 5-seat room, every one tries to claim every offer; exactly 5 must win.
function rush(engine, db) {
  const id = 'rush';
  addTestRoom(db, id, 5);
  const people = Array.from({ length: 50 }, (_, i) => `stand-in-rush-${i}`);
  for (const p of people) engine.joinQueue(id, { handle: p, needs: [] }, null);
  const offers = [...db.offers.values()].filter((o) => o.space === id);
  let winners = 0;
  for (const p of people) for (const o of offers) { try { engine.claim(o.id, p); winners++; } catch { /* lost the race, as expected */ } }
  removeTestRoom(db, id);
  return { people: people.length, seats: 5, winners };
}

const LOADTEST_ROOM = 'loadtest';

// A test room is a normal room flagged `test`, so the screens' room lists and redirects skip it.
function addTestRoom(db, id, seats) {
  db.spaces.set(id, { id, type: 'room', test: true, floor: 0, pos: 0, title: 'Load test room', capacity: seats, tags: [], stepFree: true, access: 'Test', rule: 'First come', accessZones: [], correction: 0, freeZones: [], override: null, confirmed: false, pending: null, staffOn: null, redirectHolds: [] });
  db.checkins.set(id, new Map());
}

// Removes a test room with everything in it. With `guests`, also the guest accounts whose only queue entries were here.
function removeTestRoom(db, id, { guests = false } = {}) {
  if (!db.spaces.get(id)?.test) return { removed: false };
  const here = new Set(db.queue.filter((q) => q.space === id).map((q) => q.handle));
  const elsewhere = new Set(db.queue.filter((q) => q.space !== id).map((q) => q.handle));
  db.spaces.delete(id);
  db.checkins.delete(id);
  for (const [oid, o] of db.offers) if (o.space === id) db.offers.delete(oid);
  db.queue = db.queue.filter((q) => q.space !== id);
  let removedGuests = 0;
  if (guests) for (const h of here) if (h.startsWith('guest-') && !elsewhere.has(h) && db.users.delete(h)) removedGuests++;
  return { removed: true, guests: removedGuests };
}


module.exports = { api, rush };

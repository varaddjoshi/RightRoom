// Dash0 proof numbers beyond SLO 1 (src/metrics.js). All of them are observed from OUTSIDE the seat engine:
// instrument() wraps the engine's own methods, and stream.publish() calls observe() for live events, so
// src/engine.js and src/routes/api.js are not touched. Metric attributes are low-cardinality on purpose: never a
// handle, an id or free text.
//
//   SLO 2: "anyone turned away is offered a seat (or shown a redirect) within 30 seconds"
//     rightroom.slo2.responses            counter  slo2.outcome = offer | redirect | none, slo2.within_30s = true|false
//     rightroom.slo2.time_to_response     histogram (ms), slo2.outcome = offer | redirect
//     A person is "turned away" when joining a room's queue leaves them waiting. Getting neither an offer nor a
//     redirect within 30 s is recorded as a MISS (outcome none), so unlike SLO 1 a failure shows up in the numbers.
//   Accessible seats: rightroom.slo2.accessible_offers (all) and rightroom.slo2.accessible_seat_misassigned
//     (offered to someone with no stated need; must stay 0), so Dash0 can show "0 of N".
//   Redirects: rightroom.redirects, redirect.followed = true|false, recorded when it is settled: the person checked
//     in at the suggested room within 15 minutes (true) or the 15 minutes ran out (false).
//   Staff overrides: rightroom.staff.overrides (override.mode = full | not_full | clear) and
//     rightroom.room.full_events (a room going Full). Override rate = not_full overrides / full events.
//
// Left out of every number: the load-test room (flagged `test`) and stand-in people (handles starting "stand-in"),
// so the 50-for-5 test and the simulator never look like real misses. Real elapsed time is used (Date.now), never the
// demo clock, because these are durations people actually waited.
// Without the OpenTelemetry SDK (tests, CI) the API gives no-op instruments, so this is safe to load everywhere.
const { metrics } = require('@opentelemetry/api');

const SLO2_MS = 30_000;
const REDIRECT_WINDOW_MS = 15 * 60_000;

const meter = metrics.getMeter('rightroom');
const timeToResponse = meter.createHistogram('rightroom.slo2.time_to_response', {
  description: 'Time from being turned away from a full room to the first seat offer or redirect (SLO 2)',
  unit: 'ms',
  // A boundary exactly at the 30 s target.
  advice: { explicitBucketBoundaries: [500, 1000, 2000, 5000, 10_000, 20_000, 30_000, 60_000] },
});
const responses = meter.createCounter('rightroom.slo2.responses', {
  description: 'People turned away from a full room, by whether and how they got an answer within 30 seconds (SLO 2)',
});
const accessibleOffers = meter.createCounter('rightroom.slo2.accessible_offers', {
  description: 'Offers of an accessible seat (the denominator for the misassigned guard)',
});
const accessibleMisassigned = meter.createCounter('rightroom.slo2.accessible_seat_misassigned', {
  description: 'Accessible seats offered to someone with no stated need. Must stay 0.',
});
const redirectsCounter = meter.createCounter('rightroom.redirects', {
  description: 'Settled redirects: did the person check in at the suggested room within 15 minutes',
});
const overridesCounter = meter.createCounter('rightroom.staff.overrides', {
  description: 'Staff overrides of a room status, by mode',
});
const fullEvents = meter.createCounter('rightroom.room.full_events', {
  description: 'Times a room went Full (the denominator for the staff override rate)',
});

const ctx = { store: null, clock: Date.now };
const waiting = new Map(); // "handle|space" -> { t0, timer }: turned away, no answer yet
const pendingRedirects = new Map(); // handle -> { room, timer }: redirected, not yet settled
const lastStatus = new Map(); // space -> last status seen, to count transitions to Full
// Count at most one SLO 2 outcome per person per room, and one settled redirect per person per room, so a loop of
// join / redirect / leave (or redirect / check in) cannot inflate the numbers. /api is open to anyone and guests are
// free to create, so this is about one person repeating; it does not stop someone making many guests.
const settled = new Set(); // "handle|space" already given an SLO 2 outcome
const settledRedirects = new Set(); // "handle|room" already given a settled redirect
const remember = (set, k) => { if (set.size >= 20_000) set.clear(); set.add(k); };

const key = (handle, space) => `${handle}|${space}`;
const isTestSpace = (space) => !!ctx.store?.db?.spaces?.get?.(space)?.test;
const counts = (handle, space) => !!handle && !String(handle).startsWith('stand-in') && !isTestSpace(space);
const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
// Monitoring must never change what the engine does or returns.
const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { /* telemetry only */ } };

function record(outcome, ms) {
  const within = outcome !== 'none' && ms <= SLO2_MS;
  responses.add(1, { 'slo2.outcome': outcome, 'slo2.within_30s': within });
  if (outcome !== 'none') timeToResponse.record(Math.max(0, ms), { 'slo2.outcome': outcome });
}

function turnedAway(handle, space) {
  const k = key(handle, space);
  if (!counts(handle, space) || waiting.has(k) || settled.has(k)) return;
  const timer = unref(setTimeout(() => {
    if (waiting.delete(k)) { record('none', SLO2_MS); remember(settled, k); }
  }, SLO2_MS));
  waiting.set(k, { t0: ctx.clock(), timer });
}

function respond(handle, space, outcome) {
  const w = waiting.get(key(handle, space));
  if (!w) return;
  clearTimeout(w.timer);
  waiting.delete(key(handle, space));
  record(outcome, ctx.clock() - w.t0);
  remember(settled, key(handle, space));
}

// Not a miss: the person left the queue, or checked in somewhere, before the 30 s were up.
function stopWaiting(handle, space) {
  const w = waiting.get(key(handle, space));
  if (!w) return;
  clearTimeout(w.timer);
  waiting.delete(key(handle, space));
}

function redirectShown(user, fromSpace, result) {
  const room = result?.suggestion?.room;
  if (!user?.handle || !room || !counts(user.handle, fromSpace)) return;
  respond(user.handle, fromSpace, 'redirect');
  if (settledRedirects.has(key(user.handle, room))) return; // this person already had a redirect to this room settled
  const existing = pendingRedirects.get(user.handle);
  if (existing && existing.room === room) return; // the screen refreshed; same redirect
  if (existing) clearTimeout(existing.timer); // a newer suggestion replaces the old one
  const timer = unref(setTimeout(() => {
    if (pendingRedirects.get(user.handle)?.room === room) {
      pendingRedirects.delete(user.handle);
      remember(settledRedirects, key(user.handle, room));
      redirectsCounter.add(1, { 'redirect.followed': false });
    }
  }, REDIRECT_WINDOW_MS));
  pendingRedirects.set(user.handle, { room, timer });
}

function checkedIn(handle, space) {
  stopWaiting(handle, space);
  const p = pendingRedirects.get(handle);
  if (p && p.room === space) {
    clearTimeout(p.timer);
    pendingRedirects.delete(handle);
    remember(settledRedirects, key(handle, space));
    redirectsCounter.add(1, { 'redirect.followed': true });
  }
}

// Called by stream.publish() for every live event.
const observe = safe((type, data, to) => {
  if (type === 'offer' && to?.handle) {
    respond(to.handle, data.space, 'offer');
    if (data.accessible && !isTestSpace(data.space)) {
      accessibleOffers.add(1);
      const entry = ctx.store?.db?.queue?.find?.((q) => q.handle === to.handle && q.space === data.space && q.status === 'offered');
      if (entry && !(entry.needs && entry.needs.length)) accessibleMisassigned.add(1);
    }
  } else if (type === 'status' && data.space) {
    const prev = lastStatus.get(data.space);
    lastStatus.set(data.space, data.status);
    // A real transition only: a room already Full the first time we see it (after a restart) is not a new Full event.
    if (data.status === 'full' && prev && prev !== 'full' && !isTestSpace(data.space)) fullEvents.add(1);
  }
});

function wrap(engine, name, make) {
  const original = engine[name];
  if (typeof original !== 'function') return;
  engine[name] = make(original.bind(engine));
}

// Wrap the engine's methods. Idempotent. Pass the store so excluded rooms and queue entries can be looked up.
function instrument({ engine, store, clock = Date.now }) {
  if (engine.__slo2) return engine;
  ctx.store = store;
  ctx.clock = clock;
  const queued = (spaceId, handle) => !!store?.db?.queue?.some?.((q) => q.space === spaceId && q.handle === handle && ['waiting', 'offered'].includes(q.status));
  const waitingNow = (spaceId, handle) => !!store?.db?.queue?.some?.((q) => q.space === spaceId && q.handle === handle && q.status === 'waiting');

  wrap(engine, 'joinQueue', (orig) => (spaceId, user, ...rest) => {
    const had = safe(queued)(spaceId, user?.handle);
    const res = orig(spaceId, user, ...rest);
    // The engine returns an existing entry when the same DEVICE joins again under a different guest handle. That
    // person has no entry of their own, so only start a clock if THIS handle is now waiting in the queue.
    if (!had && res && res.status === 'waiting' && safe(waitingNow)(spaceId, user?.handle)) safe(turnedAway)(user.handle, String(spaceId));
    return res;
  });
  wrap(engine, 'leaveQueue', (orig) => (spaceId, handle, ...rest) => {
    const res = orig(spaceId, handle, ...rest);
    safe(stopWaiting)(handle, String(spaceId));
    return res;
  });
  wrap(engine, 'redirect', (orig) => (spaceId, user, ...rest) => {
    const res = orig(spaceId, user, ...rest);
    safe(redirectShown)(user, String(spaceId), res);
    return res;
  });
  wrap(engine, 'checkin', (orig) => (spaceId, user, ...rest) => {
    const res = orig(spaceId, user, ...rest);
    safe(checkedIn)(user?.handle, String(spaceId));
    return res;
  });
  wrap(engine, 'override', (orig) => (spaceId, mode, ...rest) => {
    const res = orig(spaceId, mode, ...rest);
    safe(() => { if (!isTestSpace(String(spaceId))) overridesCounter.add(1, { 'override.mode': ['full', 'not_full', 'clear'].includes(mode) ? mode : 'other' }); })();
    return res;
  });
  Object.defineProperty(engine, '__slo2', { value: true });
  return engine;
}

// Test helper: forget everything in flight.
function reset() {
  for (const w of waiting.values()) clearTimeout(w.timer);
  for (const p of pendingRedirects.values()) clearTimeout(p.timer);
  waiting.clear(); pendingRedirects.clear(); lastStatus.clear(); settled.clear(); settledRedirects.clear();
}

module.exports = { instrument, observe, reset, SLO2_MS, REDIRECT_WINDOW_MS };

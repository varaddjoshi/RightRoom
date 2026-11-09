// Seat allocation rules from docs/architecture.md (rules 1-5) and docs/journey-map.md (decisions 14-30).
// Storage-agnostic: works on whatever `store.db` holds; `redirect` and `publish` are passed in so the ES versions can replace them.
const crypto = require('node:crypto');
const { ZONES } = require('./mock/seed');
const { SEAT_NEEDS } = require('./auth');

const OFFER_MS = 60_000;          // seat offer hold
const CONFIRM_MS = 30_000;        // staff answer window before Full goes out
const ADMIT_MS = 30 * 60_000;     // venue admission expiry

// Claim window (Varad's decision replacing 31-32): none unless an organiser sets one, so by default a claimed seat is
// held until scan-in or the session ends. `policy.claimWindowMs(needs)` returns milliseconds or null; it is where
// src/policy.js (P1, coming) plugs in, with its separate time for a stated access need and the walking-time add-on.
const NO_POLICY = { claimWindowMs: () => null };

// `now` defaults to src/clock.js (P1), so offers, claims and the sweeper run on the same demo clock as redirect,
// floors and search (DEMO_CLOCK).
function createEngine({ store, redirect, publish = () => {}, now = require('./clock').nowMs, policy = NO_POLICY }) {
  const db = () => store.db;
  const space = (id) => db().spaces.get(String(id));
  const inside = (sp) => db().checkins.get(sp.id) || new Map();
  const heldOffers = (sp) => [...db().offers.values()].filter((o) => o.space === sp.id && (o.status === 'offered' || o.status === 'claimed'));
  const waiting = (sp) => db().queue.filter((q) => q.space === sp.id && q.status === 'waiting').sort((a, b) => a.at - b.at);

  // Rule 4 / decision 14: count = check-ins + staff correction + held offers.
  function taken(sp) {
    if (sp.type === 'venue') return admitted().length;
    return Math.max(0, inside(sp).size + sp.correction) + heldOffers(sp).length;
  }
  function status(sp) {
    if (sp.type === 'venue') return taken(sp) >= sp.capacity ? 'full' : taken(sp) >= 0.8 * sp.capacity ? 'filling' : 'free';
    if (sp.override === 'full') return 'full';
    const t = taken(sp);
    if (t >= sp.capacity && sp.override !== 'not_full') return sp.confirmed ? 'full' : 'checking'; // at capacity, staff confirming: "Full · being checked", never "Filling" at 0 free
    return t >= 0.8 * sp.capacity ? 'filling' : 'free';
  }
  function view(sp) {
    const t = taken(sp);
    const base = { id: sp.id, type: sp.type, floor: sp.floor, title: sp.title, capacity: sp.capacity, taken: t, free: Math.max(0, sp.capacity - t), status: status(sp), rule: sp.rule };
    if (sp.type === 'venue') return { ...base, scannedIn: admitted().filter((q) => q.scannedIn).length };
    Object.assign(base, { name: sp.name || null, building: sp.building || null, session: sp.session || null });
    // Seats held for people already sent here by a redirect (SLO 2); `free` stays the one number everyone shows.
    base.heldForRedirects = (sp.redirectHolds || []).filter((h) => h.until > now()).length;
    const zoneFill = Object.fromEntries(ZONES.map((z) => [z, 0]));
    let standIn = 0;
    for (const c of inside(sp).values()) { zoneFill[c.zone] = (zoneFill[c.zone] || 0) + 1; if (c.standIn) standIn++; }
    return { ...base, tags: sp.tags, stepFree: sp.stepFree, access: sp.access, accessZones: sp.accessZones, zoneFill, standIn, pendingConfirm: sp.pending ? Math.max(0, Math.ceil((sp.pending - now()) / 1000)) : null };
  }

  // Called after every change: offers free seats to the queue first (decision 17), then works out Full (decisions 14-15).
  function update(sp) {
    if (sp.type === 'room') {
      fill(sp);
      const atCap = taken(sp) >= sp.capacity;
      if (!atCap) { sp.confirmed = false; sp.pending = null; }
      else if (!sp.confirmed && !sp.pending) {
        if (sp.staffOn) { sp.pending = now() + CONFIRM_MS; publish('confirm', { space: sp.id, taken: taken(sp), capacity: sp.capacity, seconds: CONFIRM_MS / 1000 }, { space: sp.id }); }
        else sp.confirmed = true;
      }
    }
    const v = view(sp);
    publish('status', { space: sp.id, taken: v.taken, capacity: v.capacity, status: v.status }, { space: sp.id });
    for (const q of waiting(sp)) publish('position', { space: sp.id, handle: q.handle, ...position(q) }, { handle: q.handle });
    return v;
  }

  function position(q) {
    const list = waiting(space(q.space));
    return { position: list.indexOf(q) + 1, reason: 'Seats go first come, within accessibility fit.' };
  }

  // Offer free seats to the queue in order. Accessible seats only go to people who stated a need (project.md Must).
  function fill(sp) {
    for (let guard = 0; taken(sp) < sp.capacity && guard < sp.capacity; guard++) {
      const list = waiting(sp);
      if (!list.length) break;
      const isAccess = (z) => !!z && sp.accessZones.includes(z);
      let q = list[0];
      let zi = sp.freeZones.findIndex((z) => !isAccess(z));
      const needy = list.find((x) => x.needs.some((n) => SEAT_NEEDS.includes(n)));
      const ai = sp.freeZones.findIndex(isAccess);
      if (needy && ai >= 0) { q = needy; zi = ai; }
      const unzoned = sp.capacity - taken(sp) > sp.freeZones.length; // seats free without a known zone
      if (zi < 0 && !unzoned) break; // only accessible seats left and nobody waiting needs one
      offer(sp, q, zi >= 0 ? sp.freeZones.splice(zi, 1)[0] : null);
    }
  }

  function offer(sp, q, zone) {
    const id = `o${++db().seq}`;
    const o = { id, space: sp.id, handle: q.handle, zone, accessible: !!(zone && sp.accessZones.includes(zone)), status: 'offered', heldUntil: now() + OFFER_MS, version: 1, needs: q.needs };
    db().offers.set(id, o);
    q.status = 'offered';
    q.offer = id;
    publish('offer', { offer: id, space: sp.id, zone, accessible: o.accessible, seconds: OFFER_MS / 1000 }, { handle: q.handle });
    return o;
  }

  function joinQueue(spaceId, user, device) {
    const sp = space(spaceId);
    if (!sp || sp.type !== 'room') throw err(404, 'No such room');
    // Decision 28: one place per user, or per device for guests.
    const mine = db().queue.find((q) => q.space === sp.id && ['waiting', 'offered'].includes(q.status) && (q.handle === user.handle || (device && q.device === device)));
    if (mine) return { ...entryView(mine) };
    const q = { id: `q${++db().seq}`, space: sp.id, handle: user.handle, device, needs: user.needs || [], at: now(), status: 'waiting' };
    db().queue.push(q);
    update(sp);
    return entryView(q);
  }

  function leaveQueue(spaceId, handle) {
    const q = db().queue.find((x) => x.space === String(spaceId) && x.handle === handle && x.status === 'waiting');
    if (q) { q.status = 'left'; update(space(spaceId)); }
    return { left: !!q };
  }

  function entryView(q) {
    const base = { space: q.space, status: q.status };
    if (q.status === 'waiting') return { ...base, ...position(q) };
    if (q.status === 'offered') { const o = db().offers.get(q.offer); return { ...base, offer: offerView(o) }; }
    return base;
  }
  function offerView(o) {
    if (!o) return null;
    return { id: o.id, space: o.space, zone: o.zone, accessible: o.accessible, status: o.status, secondsLeft: Math.max(0, Math.ceil((o.heldUntil - now()) / 1000)), code: o.status === 'claimed' ? o.code : undefined, scanBy: o.scanBy };
  }

  // Rule 1: claim flips one offer, only for its holder, only while the hold lasts. Version check guards a stale client.
  function claim(offerId, handle, version) {
    const o = db().offers.get(String(offerId));
    if (!o || o.handle !== handle) throw err(404, 'No such offer for you');
    if (version !== undefined && Number(version) !== o.version) throw err(409, 'Offer changed, reload');
    if (o.status !== 'offered') throw err(409, `Offer is ${o.status}`);
    if (now() > o.heldUntil) throw err(409, 'Offer expired');
    o.status = 'claimed';
    o.version++;
    o.code = code();
    const window = policy.claimWindowMs?.(o.needs) ?? null;
    o.scanBy = window ? now() + window : null;
    const q = db().queue.find((x) => x.offer === o.id);
    if (q) q.status = 'claimed';
    update(space(o.space));
    return offerView(o);
  }

  function checkin(spaceId, user, zone) {
    const sp = space(spaceId);
    if (!sp) throw err(404, 'No such space');
    if (sp.type === 'venue') return scanVenue(user.handle);
    if (zone && !ZONES.includes(zone)) throw err(400, 'Unknown zone');
    const touched = new Set();
    // Decision 14: checking in here checks you out everywhere else.
    for (const [sid, m] of db().checkins) if (sid !== sp.id && m.delete(user.handle)) touched.add(space(sid));
    // Settle every seat this person holds, so nobody is counted as both inside and holding an offer.
    for (const x of db().offers.values()) {
      if (x.handle !== user.handle || !['offered', 'claimed'].includes(x.status)) continue;
      if (x.space === sp.id) { x.status = 'used'; zone = zone || x.zone; }
      else { x.status = 'expired'; space(x.space).freeZones.push(x.zone); touched.add(space(x.space)); }
    }
    for (const q of db().queue) {
      if (q.handle !== user.handle || q.space === 'venue') continue;
      if (q.space === sp.id && ['waiting', 'offered', 'claimed'].includes(q.status)) q.status = 'in';
      else if (['offered', 'claimed'].includes(q.status)) { q.status = 'left'; touched.add(space(q.space)); }
    }
    if (!db().checkins.has(sp.id)) db().checkins.set(sp.id, new Map());
    inside(sp).set(user.handle, { zone: zone || 'middle-centre', at: now() });
    const room = update(sp);
    for (const t of touched) update(t);
    return { checkedIn: true, space: sp.id, zone: inside(sp).get(user.handle).zone, room };
  }

  // Decision 21: leaving drops the count and offers the seat; the offer replaces the check-in, so nothing is counted twice.
  function leave(spaceId, handle) {
    const sp = space(spaceId);
    const c = sp && inside(sp).get(handle);
    if (!c) throw err(409, 'You are not checked in here');
    inside(sp).delete(handle);
    sp.freeZones.push(c.zone);
    return { left: true, room: update(sp) };
  }

  // Staff correction (decision 22): + for walk-ins who didn't scan, - for people who left without tapping.
  function correct(spaceId, delta) {
    const sp = room(spaceId);
    sp.correction = Math.max(-inside(sp).size, sp.correction + delta);
    return update(sp);
  }

  // Decision 18: never release more than the people counted inside, so held offers can't be offered again.
  function release(spaceId, n, zone) {
    const sp = room(spaceId);
    if (zone && !ZONES.includes(zone)) throw err(400, 'Unknown zone');
    const counted = Math.max(0, inside(sp).size + sp.correction);
    const k = Math.min(n, counted);
    sp.correction -= k;
    for (let i = 0; i < k; i++) sp.freeZones.push(zone || null);
    sp.confirmed = false;
    const before = db().offers.size;
    const v = update(sp);
    return { released: k, offers: db().offers.size - before, room: v };
  }

  function override(spaceId, mode) {
    const sp = room(spaceId);
    sp.override = mode === 'clear' ? null : mode;
    if (mode === 'full') { sp.confirmed = true; sp.pending = null; }
    return update(sp);
  }

  function setConsole(spaceId, handle, action) {
    const sp = room(spaceId);
    const offDoor = (r) => {
      r.staffOn = null;
      // With nobody on the door a pending Full goes out straight away (decision 15).
      if (r.pending) { r.pending = null; r.confirmed = true; }
    };
    if (action === 'open') {
      // One door per staff member (issue #23, bug 4): opening this console leaves any other door they were on.
      for (const other of db().spaces.values()) if (other !== sp && other.staffOn === handle) { offDoor(other); update(other); }
      sp.staffOn = handle;
    } else offDoor(sp);
    return update(sp);
  }

  function confirm(spaceId, answer, n, zone) {
    const sp = room(spaceId);
    sp.pending = null;
    if (answer === 'full') { sp.confirmed = true; return update(sp); }
    return release(sp.id, n, zone).room;
  }

  // Decision 6 and 24: registering joins the venue queue; admission expires unless scanned in.
  function admitted() { return db().queue.filter((q) => q.space === 'venue' && q.status === 'admitted'); }
  function register(user) {
    const venue = space('venue');
    let q = db().queue.find((x) => x.space === 'venue' && x.handle === user.handle && ['admitted', 'waiting'].includes(x.status));
    if (!q) {
      q = { id: `q${++db().seq}`, space: 'venue', handle: user.handle, needs: user.needs || [], at: now(), status: 'waiting' };
      db().queue.push(q);
      admitVenue();
    }
    update(venue);
    return venueEntry(q);
  }
  function admitVenue() {
    const venue = space('venue');
    for (const q of waiting(venue)) {
      if (admitted().length >= venue.capacity) break;
      q.status = 'admitted';
      q.admittedAt = now();
      q.expiresAt = Math.max(venue.doorsOpen, q.admittedAt) + ADMIT_MS;
      publish('position', { space: 'venue', handle: q.handle, status: 'admitted' }, { handle: q.handle });
    }
  }
  function venueEntry(q) {
    if (!q) return null;
    if (q.status === 'waiting') return { status: 'waiting', position: waiting(space('venue')).indexOf(q) + 1, reason: 'Admitted in order of registration.' };
    return { status: q.status, scannedIn: !!q.scannedIn, expiresAt: q.expiresAt };
  }
  // Latest entry wins, so a re-registration replaces an expired one.
  function myVenue(handle) { return venueEntry(db().queue.findLast((x) => x.space === 'venue' && x.handle === handle && x.status !== 'left')); }
  function scanVenue(handle) {
    const q = db().queue.find((x) => x.space === 'venue' && x.handle === handle && x.status === 'admitted');
    if (!q) throw err(409, 'You are not admitted to the venue');
    q.scannedIn = true;
    return { checkedIn: true, space: 'venue', ...venueEntry(q) };
  }

  // Every 2 seconds: expire offers and pass them on, release unscanned claims, time out confirms, expire venue admissions.
  function sweep() {
    const t = now();
    const touched = new Set();
    for (const o of db().offers.values()) {
      const expired = (o.status === 'offered' && t > o.heldUntil) || (o.status === 'claimed' && o.scanBy != null && t > o.scanBy);
      if (!expired) continue;
      o.status = 'expired';
      const sp = space(o.space);
      sp.freeZones.unshift(o.zone);
      const q = db().queue.find((x) => x.offer === o.id);
      // Missed offer: passed on, and the person goes back to the end of the queue.
      if (q && ['offered', 'claimed'].includes(q.status)) { q.status = 'waiting'; q.at = t; q.offer = undefined; }
      publish('offer_passed', { offer: o.id, space: o.space }, { handle: o.handle });
      touched.add(sp);
    }
    for (const sp of db().spaces.values()) if (sp.pending && t > sp.pending) { sp.pending = null; sp.confirmed = true; touched.add(sp); }
    for (const q of admitted()) if (!q.scannedIn && q.expiresAt && t > q.expiresAt) { q.status = 'expired'; touched.add(space('venue')); }
    if (touched.has(space('venue'))) admitVenue();
    for (const sp of touched) update(sp);
  }

  function endSession(spaceId) {
    const sp = room(spaceId);
    db().checkins.set(sp.id, new Map());
    for (const q of db().queue) if (q.space === sp.id && ['waiting', 'offered', 'claimed'].includes(q.status)) q.status = 'ended';
    for (const o of db().offers.values()) if (o.space === sp.id && ['offered', 'claimed'].includes(o.status)) o.status = 'expired';
    Object.assign(sp, { correction: 0, freeZones: [], override: null, confirmed: false, pending: null });
    return update(sp);
  }

  function room(id) {
    const sp = space(id);
    if (!sp || sp.type !== 'room') throw err(404, 'No such room');
    return sp;
  }

  function roomForUser(spaceId, handle) {
    const sp = space(spaceId);
    if (!sp) throw err(404, 'No such space');
    const v = view(sp);
    if (!handle) return v;
    if (sp.type === 'venue') return { ...v, me: { venue: myVenue(handle) } };
    const q = db().queue.find((x) => x.space === sp.id && x.handle === handle && ['waiting', 'offered', 'claimed'].includes(x.status));
    const claimed = q && q.status === 'claimed' ? offerView(db().offers.get(q.offer)) : null;
    const c = inside(sp).get(handle);
    return { ...v, me: { queue: q && q.status !== 'claimed' ? entryView(q) : null, claimed, checkedIn: c ? { zone: c.zone } : null } };
  }

  // Every place one person holds, across all rooms (decision 34: seated in one room, queued in others), plus the venue.
  // Guests are matched by device too (decision 28). Offers and claims sort first: they expire.
  const URGENCY = { offered: 0, claimed: 1, checkedIn: 2, waiting: 3 };
  function myPlaces(handle, device) {
    const rooms = [];
    for (const sp of db().spaces.values()) {
      if (sp.type !== 'room' || sp.test) continue;
      const base = { room: sp.id, title: sp.title, floor: sp.floor };
      const c = inside(sp).get(handle);
      if (c) { rooms.push({ ...base, status: 'checkedIn', zone: c.zone }); continue; }
      const q = db().queue.find((x) => x.space === sp.id && ['waiting', 'offered', 'claimed'].includes(x.status) && (x.handle === handle || (device && x.device === device)));
      if (!q) continue;
      const o = q.offer && db().offers.get(q.offer);
      if (q.status === 'waiting') rooms.push({ ...base, status: 'waiting', position: position(q).position, of: waiting(sp).length });
      else if (q.status === 'offered') rooms.push({ ...base, status: 'offered', zone: o?.zone ?? null, offerExpiresAt: o?.heldUntil });
      else rooms.push({ ...base, status: 'claimed', zone: o?.zone ?? null, code: o?.code, scanBy: o?.scanBy ?? null });
    }
    rooms.sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || (a.position || 0) - (b.position || 0));
    return { venue: myVenue(handle), rooms };
  }

  function staffView(spaceId) {
    const sp = room(spaceId);
    const queue = db().queue.filter((q) => q.space === sp.id && ['waiting', 'offered', 'claimed'].includes(q.status)).sort((a, b) => a.at - b.at)
      .map((q) => ({ handle: q.handle, status: q.status, needs: q.needs, code: q.status === 'claimed' ? db().offers.get(q.offer)?.code : undefined, zone: q.offer ? db().offers.get(q.offer)?.zone : undefined }));
    return { ...view(sp), correction: sp.correction, staffOn: sp.staffOn, queue };
  }

  function floors(role, fromId) {
    const from = fromId ? space(fromId) : null;
    const staff = role === 'staff' || role === 'organiser';
    const rooms = [...db().spaces.values()].filter((s) => s.type === 'room' && !s.test);
    const byFloor = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => b - a);
    return byFloor.map((f) => ({
      floor: f,
      rooms: rooms.filter((r) => r.floor === f).map((r) => {
        const v = view(r);
        const out = { id: v.id, title: v.title, name: v.name, building: v.building, session: v.session, capacity: v.capacity, taken: v.taken, free: v.free, status: v.status, stepFree: v.stepFree, access: v.access, wifi: wifiMedian(r.id), walk: from ? walk(from, r) : undefined };
        if (staff) Object.assign(out, { staffOn: r.staffOn, queue: waiting(r).length });
        return out;
      }),
    }));
  }

  function walk(a, b) {
    if (!a || !b || a.id === b.id) return 0;
    // The organiser's (or P1 seed's) walking time when the venue has one, else an estimate from floors and position.
    const set = Array.isArray(a.walks) && a.walks.find((w) => w.to === b.id);
    if (set) return set.minutes;
    return 1 + Math.abs(a.floor - b.floor) * 2 + Math.abs((a.pos || 0) - (b.pos || 0));
  }

  function wifiMedian(spaceId) {
    const xs = db().wifi.filter((w) => w.space === spaceId).map((w) => w.mbps).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }

  const api = {
    space, view, taken, status, update, joinQueue, leaveQueue, claim, checkin, leave, correct, release, override, setConsole, confirm,
    register, myVenue, myPlaces, sweep, endSession, roomForUser, staffView, floors, walk, wifiMedian, waiting,
    redirect: (spaceId, user) => redirect({ db: db(), engine: api, from: room(spaceId), user, now: now() }),
  };
  return api;
}

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I so it reads cleanly at a door
  return Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join('');
}

function err(status, message) { return Object.assign(new Error(message), { status }); }

module.exports = { createEngine, err, OFFER_MS, CONFIRM_MS };

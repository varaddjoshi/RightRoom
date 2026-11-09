// The venue and its talks, as organisers and hosts edit them (P2).
//
// store.db holds both the live state (check-ins, queues, offers) and this catalog:
//   db.spaces    the venue and its rooms, in the engine's shape (the engine reads them directly)
//   db.sessions  Map talk id -> talk, in P1's rr_sessions shape (title, abstract, speakers, tags, room_id, start, end,
//                host_handles)
// With Elasticsearch on, P1's indexes are the source of truth: at start the rooms and talks are loaded from rr_spaces
// and rr_sessions (the stand-in rooms of the in-memory seed are dropped), and every organiser or host edit is written
// back there, so search, redirect and floors (P1) see it too. In memory only (tests, CI, a fresh clone) the catalog is
// the stand-in seed's 7 rooms with one talk each.
//
// Hosts are a capability, not a role: a talk's host_handles lists the usernames that may edit its details.

const clock = require('./clock');

const HANDLE = /^[a-z0-9][a-z0-9-]{2,23}$/;
const TAG = /^[a-z0-9][a-z0-9+.#-]{0,39}$/;
const HOST_FIELDS = ['title', 'abstract', 'speakers', 'tags', 'track', 'level'];
const ORGANISER_FIELDS = [...HOST_FIELDS, 'room_id', 'start', 'end'];

let esMod = null; // P1's src/es.js, only when Elasticsearch is on
const esOn = () => !!esMod;

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }

// ---- Shapes ------------------------------------------------------------------------------------------------------

const accessText = (r) => `${r.stepFree ? 'Step-free' : 'Stairs only'}${r.captions ? ' · captions' : ''}`;

// An engine room from an rr_spaces document. Live fields (correction, offers in freeZones, staff, Full state) are
// kept from the engine's current copy, so a reload or an edit never resets the count.
function roomFromDoc(id, d, prev = {}) {
  const r = {
    correction: 0, freeZones: [], override: null, confirmed: false, pending: null, staffOn: null, redirectHolds: [],
    tags: [], ...prev,
    id, type: 'room', name: d.name || id, building: d.building || null, floor: Number(d.floor) || 0, pos: d.x ?? prev.pos ?? 0,
    capacity: Number(d.capacity) || 1, accessSeats: Number(d.access_seats) || 0,
    stepFree: !!d.step_free, captions: !!d.captions, rule: d.rule || 'Seats go first come, within accessibility fit.',
    overflow: d.overflow_space_id || null, walks: Array.isArray(d.walks) ? d.walks : [],
    // The engine protects seats by zone: a room with accessibility seats keeps front-left for stated needs.
    accessZones: prev.accessZones && prev.accessSeats === Number(d.access_seats) ? prev.accessZones : (Number(d.access_seats) > 0 ? ['front-left'] : []),
  };
  r.access = accessText(r);
  r.title = prev.title || r.name;
  return r;
}

function docFromRoom(r) {
  return {
    type: 'room', name: r.name, building: r.building, floor: r.floor, capacity: r.capacity, access_seats: r.accessSeats,
    step_free: r.stepFree, captions: r.captions, rule: r.rule, overflow_space_id: r.overflow, walks: r.walks,
  };
}

const roomView = (r) => ({
  id: r.id, name: r.name, building: r.building, floor: r.floor, capacity: r.capacity, access_seats: r.accessSeats || 0,
  step_free: !!r.stepFree, captions: !!r.captions, rule: r.rule, overflow_space_id: r.overflow || null, walks: r.walks || [],
});

const talkView = (s) => s && ({
  id: s.id, title: s.title, abstract: s.abstract || '', speakers: s.speakers || [], tags: s.tags || [], track: s.track || null,
  level: s.level || null, room_id: s.room_id, start: s.start, end: s.end, hosts: s.host_handles || [], label: s.label || null,
});

// ---- Loading -----------------------------------------------------------------------------------------------------

// In memory: one talk per stand-in room, running now, so hosts and screens have something to edit.
function ensureSessions(db, nowMs = clock.nowMs()) {
  if (db.sessions instanceof Map) return;
  db.sessions = new Map();
  for (const r of db.spaces.values()) {
    if (r.type !== 'room' || r.test) continue;
    if (!r.name) r.name = `Room ${r.id}`;
    db.sessions.set(`s-${r.id}`, {
      id: `s-${r.id}`, title: r.title, abstract: '', speakers: [], tags: r.tags || [], room_id: r.id,
      start: new Date(nowMs - 10 * 60_000).toISOString(), end: new Date(nowMs + 50 * 60_000).toISOString(), host_handles: [], label: 'stand_in',
    });
  }
}

// One event is a few hundred documents, well inside one page (Elastic refuses sorting on _id, so no paging by id).
const MAX_DOCS = 10_000;
async function allDocs(es, index, excludes) {
  const res = await es.search({ index, size: MAX_DOCS, _source: { excludes }, query: { match_all: {} }, track_total_hits: true });
  const total = res.hits.total?.value ?? res.hits.hits.length;
  if (total > MAX_DOCS) console.error(`[catalog] ${index} has ${total} documents; only the first ${MAX_DOCS} are loaded.`);
  return res.hits.hits;
}

// Replaces the catalog with P1's rooms and talks. Rooms the indexes don't have (the stand-in seed's) are dropped with
// their live state; rooms they do have keep theirs.
async function loadFromES(db, { log = console } = {}) {
  esMod = require('./es');
  const es = esMod.es();
  await esMod.ensureIndexes();
  await es.indices.putMapping({ index: esMod.INDEX.sessions, properties: { host_handles: { type: 'keyword' } } });
  const [spaces, sessions] = await Promise.all([allDocs(es, esMod.INDEX.spaces, []), allDocs(es, esMod.INDEX.sessions, ['topic'])]);
  const keep = new Set();
  for (const h of spaces) {
    const d = h._source;
    if (d.type === 'venue') {
      const v = db.spaces.get('venue');
      if (v) Object.assign(v, { title: d.name || v.title, capacity: Number(d.capacity) || v.capacity, rule: d.rule || v.rule, policy: d.policy || {} });
      keep.add('venue');
    } else if (d.type === 'room') {
      db.spaces.set(h._id, roomFromDoc(h._id, d, db.spaces.get(h._id)));
      if (!db.checkins.has(h._id)) db.checkins.set(h._id, new Map());
      keep.add(h._id);
    }
  }
  const dropped = [];
  for (const [id, sp] of db.spaces) if (!keep.has(id) && !sp.test) { dropRoom(db, id); dropped.push(id); }
  db.sessions = new Map(sessions.map((h) => [h._id, { id: h._id, ...h._source }]));
  refreshTitles(db);
  log.log(`[catalog] Loaded ${keep.size - (keep.has('venue') ? 1 : 0)} rooms and ${db.sessions.size} talks from ${esMod.INDEX.spaces}/${esMod.INDEX.sessions}${dropped.length ? `; dropped stand-in rooms ${dropped.join(', ')}` : ''}.`);
  return { rooms: keep.size, talks: db.sessions.size, dropped };
}

function dropRoom(db, id) {
  db.spaces.delete(id);
  db.checkins.delete(id);
  for (const [oid, o] of db.offers) if (o.space === id) db.offers.delete(oid);
  db.queue = db.queue.filter((q) => q.space !== id);
}

// The talk on in a room now (the one that started last, if two overlap), else the next one.
function currentTalk(db, roomId, nowMs = clock.nowMs()) {
  let on = null;
  let next = null;
  for (const s of db.sessions?.values() || []) {
    if (s.room_id !== roomId) continue;
    const a = Date.parse(s.start), b = Date.parse(s.end);
    if (a <= nowMs && nowMs < b && (!on || a > Date.parse(on.start))) on = s;
    if (a > nowMs && (!next || a < Date.parse(next.start))) next = s;
  }
  return on || next;
}

// Room titles and tags follow the talk on now (the screens show the room's title), on the app's clock.
function refreshTitles(db, nowMs = clock.nowMs()) {
  for (const r of db.spaces.values()) {
    if (r.type !== 'room' || r.test) continue;
    const t = currentTalk(db, r.id, nowMs);
    r.session = t?.id || null;
    r.title = t?.title || r.name || r.id;
    r.tags = t?.tags || [];
  }
}

// ---- Writing to Elasticsearch -------------------------------------------------------------------------------------

const stamp = (db, d) => ({ ...d, event_id: db.eventId || process.env.EVENT_ID || 'kccnc-na-2026', label: 'real', updated_at: clock.now().toISOString() });

async function writeRoom(db, r, { create = false } = {}) {
  if (!esOn()) return;
  const es = esMod.es();
  const doc = stamp(db, docFromRoom(r));
  if (create) await es.index({ index: esMod.INDEX.spaces, id: r.id, document: { ...doc, created_at: doc.updated_at, taken: 0, staff_correction: 0, access_taken: 0, status: 'free', status_source: 'auto', priorities: ['access_needs'] }, refresh: 'wait_for' });
  else await es.update({ index: esMod.INDEX.spaces, id: r.id, doc, doc_as_upsert: true, refresh: 'wait_for' });
}

async function writeVenue(db, v) {
  if (!esOn()) return;
  await esMod.es().update({ index: esMod.INDEX.spaces, id: 'venue', doc: stamp(db, { type: 'venue', name: v.title, capacity: v.capacity, rule: v.rule }), doc_as_upsert: true, refresh: 'wait_for' });
}

// P1's seed builds the semantic `topic` from title, abstract and tags; an edit rebuilds it the same way.
const topicOf = (s) => `${s.title}. ${s.abstract || ''}${(s.tags || []).length ? ` Tags: ${s.tags.join(', ')}.` : ''}`;

async function writeTalk(db, s, { create = false } = {}) {
  if (!esOn()) return;
  const { id, ...rest } = s;
  const doc = stamp(db, { ...rest, topic: topicOf(s) });
  if (create) await esMod.es().index({ index: esMod.INDEX.sessions, id, document: { ...doc, created_at: doc.updated_at }, refresh: 'wait_for' });
  else await esMod.es().update({ index: esMod.INDEX.sessions, id, doc, doc_as_upsert: true, refresh: 'wait_for' });
}

async function deleteDoc(index, id) {
  if (esOn()) await esMod.es().delete({ index: esMod.INDEX[index], id, refresh: 'wait_for' }, { ignore: [404] });
}

// ---- Validation --------------------------------------------------------------------------------------------------

const str = (v, max, name, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} is required.`); return null; }
  const s = String(v).trim();
  if (!s || s.length > max) throw bad(`${name} must be 1 to ${max} characters.`);
  return s;
};
const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
};
const bool = (v, name) => { if (typeof v !== 'boolean') throw bad(`${name} must be true or false.`); return v; };
const time = (v, name) => { const t = Date.parse(v); if (!v || Number.isNaN(t)) throw bad(`${name} must be a date and time.`); return new Date(t).toISOString(); };
const list = (v, max, name, each) => {
  if (!Array.isArray(v) || v.length > max) throw bad(`${name} must be a list of up to ${max}.`);
  return [...new Set(v.map((x) => each(x)))];
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'room';

// ---- Organiser: venue --------------------------------------------------------------------------------------------

function venueView(db) {
  const v = db.spaces.get('venue');
  const rooms = [...db.spaces.values()].filter((r) => r.type === 'room' && !r.test).map(roomView);
  const buildings = [...new Set(rooms.map((r) => r.building || ''))].sort();
  return {
    venue: v ? { name: v.title, capacity: v.capacity, rule: v.rule } : null,
    layout: buildings.map((b) => ({
      building: b || null,
      floors: [...new Set(rooms.filter((r) => (r.building || '') === b).map((r) => r.floor))].sort((x, y) => x - y)
        .map((f) => ({ floor: f, rooms: rooms.filter((r) => (r.building || '') === b && r.floor === f).sort((x, y) => x.name.localeCompare(y.name)) })),
    })),
    rooms: rooms.length,
    talks: db.sessions?.size || 0,
    source: esOn() ? 'elasticsearch' : 'stand-in',
  };
}

async function updateVenue(db, body, engine) {
  const v = db.spaces.get('venue');
  if (!v) throw bad('No venue.', 404);
  if (body.name !== undefined) v.title = str(body.name, 80, 'Venue name', { required: true });
  if (body.capacity !== undefined) v.capacity = int(body.capacity, 1, 100_000, 'Venue capacity');
  if (body.rule !== undefined) v.rule = str(body.rule, 200, 'Rule', { required: true });
  await writeVenue(db, v);
  engine?.update(v);
  return venueView(db).venue;
}

// Fields an organiser can set on a room; anything left out stays as it is.
function applyRoomFields(db, r, b, { creating }) {
  if (b.name !== undefined || creating) r.name = str(b.name, 80, 'Room name', { required: true });
  if (b.building !== undefined) r.building = str(b.building, 60, 'Building');
  if (b.floor !== undefined || creating) r.floor = int(b.floor ?? 0, -5, 200, 'Floor');
  if (b.capacity !== undefined || creating) r.capacity = int(b.capacity, 1, 5000, 'Capacity');
  if (b.access_seats !== undefined) r.accessSeats = int(b.access_seats, 0, r.capacity, 'Accessibility seats');
  if (b.step_free !== undefined) r.stepFree = bool(b.step_free, 'step_free');
  if (b.captions !== undefined) r.captions = bool(b.captions, 'captions');
  if (b.rule !== undefined) r.rule = str(b.rule, 200, 'Rule', { required: true });
  if (b.overflow_space_id !== undefined) {
    const o = b.overflow_space_id || null;
    if (o && (o === r.id || db.spaces.get(o)?.type !== 'room')) throw bad('overflow_space_id must be another room.');
    r.overflow = o;
  }
  if (b.walks !== undefined) {
    r.walks = list(b.walks, 200, 'walks', (w) => {
      if (!w || db.spaces.get(w.to)?.type !== 'room' || w.to === r.id) throw bad('Each walk needs `to`: another room.');
      return JSON.stringify({ to: w.to, minutes: int(w.minutes, 0, 120, 'Walk minutes'), step_free: w.step_free === undefined ? !!db.spaces.get(w.to).stepFree : bool(w.step_free, 'step_free') });
    }).map((s) => JSON.parse(s));
  }
  if (r.accessSeats > r.capacity) r.accessSeats = r.capacity;
  r.accessZones = r.accessSeats > 0 ? (r.accessZones?.length ? r.accessZones : ['front-left']) : [];
  r.access = accessText(r);
}

// Walking times to and from a new room, the way P1's seed estimates them, until the organiser sets real ones.
function estimateWalks(db, r) {
  const est = (a, b) => Math.max(1, Math.abs((a.pos || 0) - (b.pos || 0)) + 2 * Math.abs(a.floor - b.floor) + (a.building && b.building && a.building !== b.building ? 5 : 0));
  for (const o of db.spaces.values()) {
    if (o.type !== 'room' || o.id === r.id || o.test) continue;
    if (!r.walks.some((w) => w.to === o.id)) r.walks.push({ to: o.id, minutes: est(r, o), step_free: !!o.stepFree });
    if (Array.isArray(o.walks) && !o.walks.some((w) => w.to === r.id)) o.walks.push({ to: r.id, minutes: est(o, r), step_free: !!r.stepFree });
  }
}

async function createRoom(db, body, engine) {
  const r = roomFromDoc('pending', {}, {});
  applyRoomFields(db, r, body, { creating: true });
  let id = body.id ? String(body.id) : `r-${r.floor}-${slug(r.name)}`;
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw bad('Room id: lowercase letters, numbers and hyphens.');
  if (db.spaces.has(id)) { if (body.id) throw bad('A room with that id already exists.', 409); let n = 2; while (db.spaces.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  r.id = id;
  r.title = r.name;
  db.spaces.set(id, r);
  db.checkins.set(id, new Map());
  if (body.walks === undefined) estimateWalks(db, r);
  await writeRoom(db, r, { create: true });
  refreshTitles(db);
  engine?.update(r);
  return roomView(r);
}

async function updateRoom(db, id, body, engine) {
  const r = db.spaces.get(id);
  if (!r || r.type !== 'room' || r.test) throw bad('No such room.', 404);
  applyRoomFields(db, r, body, { creating: false });
  await writeRoom(db, r);
  engine?.update(r); // a capacity change can offer seats to the queue or flip Full
  return roomView(r);
}

async function deleteRoom(db, id) {
  const r = db.spaces.get(id);
  if (!r || r.type !== 'room' || r.test) throw bad('No such room.', 404);
  const busy = (db.checkins.get(id)?.size || 0) + db.queue.filter((q) => q.space === id && ['waiting', 'offered', 'claimed'].includes(q.status)).length;
  if (busy) throw bad(`Room has ${busy} people checked in or queuing; end the session first.`, 409);
  const talks = [...(db.sessions?.values() || [])].filter((s) => s.room_id === id).length;
  if (talks) throw bad(`Room has ${talks} talks; move or delete them first.`, 409);
  dropRoom(db, id);
  for (const o of db.spaces.values()) if (Array.isArray(o.walks)) o.walks = o.walks.filter((w) => w.to !== id);
  await deleteDoc('spaces', id);
  return { deleted: id };
}

// ---- Organiser and hosts: talks ----------------------------------------------------------------------------------

function talkFields(db, b, fields, current = {}) {
  const out = {};
  const has = (k) => fields.includes(k) && b[k] !== undefined;
  if (has('title')) out.title = str(b.title, 200, 'Title', { required: true });
  if (has('abstract')) out.abstract = str(b.abstract, 4000, 'Abstract') || '';
  if (has('speakers')) out.speakers = list(b.speakers, 10, 'speakers', (x) => str(x, 80, 'Speaker', { required: true }));
  if (has('tags')) out.tags = list(b.tags, 12, 'tags', (x) => { const t = String(x).trim().toLowerCase(); if (!TAG.test(t)) throw bad('Tags: short lowercase words, e.g. observability.'); return t; });
  if (has('track')) out.track = str(b.track, 60, 'Track');
  if (has('level')) out.level = str(b.level, 40, 'Level');
  if (has('room_id')) { if (db.spaces.get(b.room_id)?.type !== 'room') throw bad('room_id must be a room.'); out.room_id = b.room_id; }
  if (has('start')) out.start = time(b.start, 'start');
  if (has('end')) out.end = time(b.end, 'end');
  const start = out.start || current.start, end = out.end || current.end;
  if (start && end && Date.parse(end) <= Date.parse(start)) throw bad('end must be after start.');
  return out;
}

function listTalks(db, { room, host, from, limit = 200 } = {}) {
  let xs = [...(db.sessions?.values() || [])];
  if (room) xs = xs.filter((s) => s.room_id === room);
  if (host) xs = xs.filter((s) => (s.host_handles || []).includes(host));
  if (from) xs = xs.filter((s) => Date.parse(s.end) >= Date.parse(from));
  xs.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  return { talks: xs.slice(0, limit).map(talkView), total: xs.length };
}

function getTalk(db, id) {
  const s = db.sessions?.get(String(id));
  if (!s) throw bad('No such talk.', 404);
  return s;
}

async function createTalk(db, body) {
  ensureSessions(db);
  const f = talkFields(db, body, ORGANISER_FIELDS);
  if (!f.room_id || !f.start || !f.end) throw bad('room_id, start and end are required.');
  if (!f.title) f.title = 'Talk to be announced';
  let id = `t-${f.room_id}-${Date.parse(f.start)}`;
  while (db.sessions.has(id)) id += 'x';
  const s = { id, abstract: '', speakers: [], tags: [], track: null, level: null, ...f, host_handles: [] };
  if (body.hosts !== undefined) s.host_handles = hostList(body.hosts);
  db.sessions.set(id, s);
  await writeTalk(db, s, { create: true });
  refreshTitles(db);
  return talkView(s);
}

// Organisers may change everything; a host only the talk's details, and only for talks they host.
async function updateTalk(db, id, body, user) {
  const s = getTalk(db, id);
  const organiser = user.role === 'organiser';
  if (!organiser && !(s.host_handles || []).includes(user.handle)) throw bad("You're not a host of this talk.", 403);
  const f = talkFields(db, body, organiser ? ORGANISER_FIELDS : HOST_FIELDS, s);
  if (!organiser) {
    const refused = Object.keys(body || {}).filter((k) => !HOST_FIELDS.includes(k));
    if (refused.length) throw bad(`Hosts can change ${HOST_FIELDS.join(', ')}; the organiser sets ${refused.join(', ')}.`, 403);
  }
  Object.assign(s, f);
  await writeTalk(db, s);
  refreshTitles(db);
  return talkView(s);
}

async function deleteTalk(db, id) {
  getTalk(db, id);
  db.sessions.delete(String(id));
  await deleteDoc('sessions', String(id));
  refreshTitles(db);
  return { deleted: String(id) };
}

function hostList(v) {
  return list(v, 10, 'hosts', (h) => { const s = String(h).trim().toLowerCase(); if (!HANDLE.test(s)) throw bad(`"${h}" is not a valid username.`); return s; });
}

async function setHosts(db, id, hosts) {
  const s = getTalk(db, id);
  s.host_handles = hostList(hosts);
  await writeTalk(db, s);
  return talkView(s);
}

const hosting = (db, handle) => [...(db.sessions?.values() || [])].filter((s) => (s.host_handles || []).includes(handle)).map((s) => s.id);

module.exports = {
  ensureSessions, loadFromES, refreshTitles, currentTalk, venueView, updateVenue, createRoom, updateRoom, deleteRoom,
  listTalks, getTalk, talkView, createTalk, updateTalk, deleteTalk, setHosts, hosting, roomFromDoc, HOST_FIELDS, esOn,
};

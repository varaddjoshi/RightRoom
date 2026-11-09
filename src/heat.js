// Per-zone heatmap for a room: crowd density from check-ins and Wi-Fi from crowd-sourced readings.
// With ELASTICSEARCH_URL set, check-ins are mirrored (anonymously) into Varad's checkins index and the crowd
// comes from an aggregation there; otherwise everything is read from memory.
const crypto = require('node:crypto');
const { ZONES } = require('./mock/seed');
const wifi = require('./wifi');

const es = () => require('./es');

function crowdBand(density) {
  return density >= 0.85 ? 'packed' : density >= 0.4 ? 'busy' : 'quiet';
}

// Heatmap-only stand-ins (scripts/stage-heat.js) live in db.heatStandIns, never in db.checkins, so they colour
// the heatmap without taking seats: the engine's taken() only reads db.checkins.
const standIns = (db) => (db.heatStandIns ??= new Map());

// Per zone: how many people, and how many of them are stand-ins (for the Live / Stand-in label).
function memoryCrowd(db, id) {
  const counts = Object.fromEntries(ZONES.map((z) => [z, { count: 0, standIn: 0 }]));
  const people = [...(db.checkins.get(id) || new Map()).values(), ...(standIns(db).get(id) || new Map()).values()];
  for (const c of people) if (c.zone in counts) { counts[c.zone].count++; if (c.standIn) counts[c.zone].standIn++; }
  return counts;
}

const crowdLabel = (c) => (!c.count ? null : c.standIn === c.count ? 'stand_in' : c.standIn ? 'mixed' : 'live');

async function esCrowd() {
  const { es: client, INDEX } = es();
  const r = await client().search({
    index: INDEX.checkins, size: 0,
    aggs: { rooms: { terms: { field: 'space_id', size: 500 }, aggs: { zones: { terms: { field: 'zone', size: 20 }, aggs: { labels: { terms: { field: 'label', size: 5 } } } } } } },
  });
  const zone = (z) => ({ count: z.doc_count, standIn: z.labels.buckets.find((l) => l.key === 'stand_in')?.doc_count || 0 });
  return Object.fromEntries(r.aggregations.rooms.buckets.map((b) => [b.key, Object.fromEntries(b.zones.buckets.map((z) => [z.key, zone(z)]))]));
}

// shortcut: cached for 10 s and refreshed in the background so /api/floors stays synchronous.
const cache = { at: 0, rooms: null, pending: null };
function refresh() {
  if (!wifi.hasEs() || cache.pending || Date.now() - cache.at < 10_000) return;
  cache.pending = esCrowd()
    .then((rooms) => { cache.rooms = rooms; cache.at = Date.now(); })
    .catch((e) => { cache.at = Date.now(); console.warn(`[heat] crowd from Elasticsearch failed: ${e.message}`); })
    .finally(() => { cache.pending = null; });
}

// Every zone is always returned, so the UI never gets an empty grid: no data means count 0 and wifi null.
function heat(db, sp) {
  refresh();
  const fromEs = cache.rooms?.[sp.id];
  const counts = fromEs ? { ...memoryCrowd({ checkins: new Map(), heatStandIns: new Map() }, sp.id), ...fromEs } : memoryCrowd(db, sp.id);
  const zoneCap = Math.max(1, sp.capacity / ZONES.length); // shortcut: zones share seats equally until zones define seats
  const w = wifi.zoneStats(db, sp.id);
  const zones = ZONES.map((zone) => {
    const c = counts[zone] || { count: 0, standIn: 0 };
    const density = Math.min(1, Math.round((c.count / zoneCap) * 100) / 100);
    const z = w.zones[zone];
    return {
      zone,
      crowd: { count: c.count, density, band: crowdBand(density), label: crowdLabel(c) },
      wifi: z ? { mbps: z.mbps, ms: z.ms, count: z.count, band: z.band, label: z.label } : null,
    };
  });
  const source = fromEs || w.source === 'elasticsearch' ? 'elasticsearch' : 'memory';
  // Room label: every number underneath is stand-in, every one live, or a mix (null when there's no data at all).
  const labels = new Set(zones.flatMap((z) => [z.crowd.label, z.wifi?.label]).filter(Boolean));
  const label = !labels.size ? null : labels.size > 1 || labels.has('mixed') ? 'mixed' : [...labels][0];
  return { room: sp.id, source, label, zones, updatedAt: new Date(fromEs ? cache.at : Date.now()).toISOString() };
}

// Compact summary for floor tiles: the busiest zone and the weakest Wi-Fi zone (null when there's no data).
function tileSummary(h) {
  const busy = h.zones.filter((z) => z.crowd.count).sort((a, b) => b.crowd.density - a.crowd.density)[0];
  const weak = h.zones.filter((z) => z.wifi).sort((a, b) => a.wifi.mbps - b.wifi.mbps)[0];
  return {
    busiest: busy ? { zone: busy.zone, density: busy.crowd.density, band: busy.crowd.band } : null,
    weakestWifi: weak ? { zone: weak.zone, mbps: weak.wifi.mbps, band: weak.wifi.band } : null,
  };
}

// Anonymous mirror of check-ins into Elasticsearch: one doc per person in a room, id hashed so no handle is stored.
// Rooms whose check-ins didn't change since the last pass are skipped. Leaving or a session ending removes the docs.
const seen = new Map();
const secret = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
const docId = (room, handle) => crypto.createHmac('sha256', secret).update(`${room}\n${handle}`).digest('hex').slice(0, 32);

async function mirror(db) {
  const { es: client, INDEX } = es();
  for (const room of new Set([...db.checkins.keys(), ...standIns(db).keys()])) {
    const m = new Map([...(db.checkins.get(room) || []), ...(standIns(db).get(room) || [])]);
    const sig = [...m].map(([h, c]) => `${h}:${c.zone}`).sort().join('|');
    if (seen.get(room) === sig) continue;
    await client().deleteByQuery({ index: INDEX.checkins, query: { term: { space_id: room } }, refresh: true, conflicts: 'proceed' });
    const ops = [...m].flatMap(([h, c]) => [
      { index: { _index: INDEX.checkins, _id: docId(room, h) } },
      { space_id: room, zone: c.zone, at: new Date(c.at || Date.now()).toISOString(), label: c.standIn ? 'stand_in' : 'live' },
    ]);
    if (ops.length) await client().bulk({ operations: ops, refresh: true });
    seen.set(room, sig);
  }
}

let timer;
function startMirror(getDb, everyMs = 5000) {
  if (!wifi.hasEs() || timer) return;
  timer = setInterval(() => mirror(getDb()).catch((e) => console.warn(`[heat] mirror failed: ${e.message}`)), everyMs).unref();
}

// Adds wifiStats and a compact heat summary to every /api/floors tile; existing fields stay as they were.
function withHeat(db, engine, floors) {
  return floors.map((f) => ({ ...f, rooms: f.rooms.map((r) => ({ ...r, wifiStats: wifi.roomStats(db, r.id), heat: tileSummary(heat(db, engine.space(r.id))) })) }));
}

module.exports = { withHeat, heat, tileSummary, crowdBand, memoryCrowd, standIns, startMirror, mirror };

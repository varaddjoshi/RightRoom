// Crowd-sourced Wi-Fi readings: kept in memory (db().wifi) and, with ELASTICSEARCH_URL set, also indexed into
// Varad's wifi_readings index so per-room and per-zone speeds survive restarts and can be aggregated there.
const { median } = require('./insights');

const hasEs = () => Boolean(process.env.ELASTICSEARCH_URL);
const es = () => require('./es'); // lazy: the client is only built when Elasticsearch is configured

function band(mbps) {
  if (mbps == null) return null;
  return mbps >= 25 ? 'good' : mbps >= 8 ? 'ok' : 'weak';
}

function toDoc(r) {
  return {
    space_id: r.space, zone: r.zone, floor: r.floor, download_mbps: r.mbps, latency_ms: r.ms,
    at: new Date(r.at).toISOString(), label: r.standIn ? 'stand_in' : 'live',
  };
}

// Never fails the request: an Elasticsearch outage only loses the copy there, the reading stays in memory.
function record(db, reading) {
  db.wifi.push(reading);
  if (hasEs()) {
    const { es: client, INDEX } = es();
    client().index({ index: INDEX.wifi_readings, document: toDoc(reading) })
      .catch((e) => console.warn(`[wifi] could not index reading: ${e.message}`));
  }
  return reading;
}

// What the numbers are made of, for the Live / Stand-in label on screen: all stand-in, all live, or mixed.
function labelOf(kinds) {
  const k = new Set(kinds);
  if (!k.size) return null;
  if (k.size > 1) return 'mixed';
  return k.has('stand_in') ? 'stand_in' : 'live';
}

const stat = (rs) => {
  const mbps = median(rs.map((r) => r.mbps));
  return { mbps, ms: median(rs.map((r) => r.ms)), count: rs.length, last: Math.max(...rs.map((r) => r.at || 0)) || null, band: band(mbps), label: labelOf(rs.map((r) => (r.standIn ? 'stand_in' : 'live'))) };
};

// Memory summary: { [room]: { mbps, ms, count, last, band, zones: { [zone]: {...same} } } }
function summarize(readings) {
  const rooms = {};
  for (const r of readings) {
    const room = (rooms[r.space] ??= { all: [], zones: {} });
    room.all.push(r);
    (room.zones[r.zone] ??= []).push(r);
  }
  return Object.fromEntries(Object.entries(rooms).map(([id, r]) => [id, {
    ...stat(r.all),
    zones: Object.fromEntries(Object.entries(r.zones).map(([z, rs]) => [z, stat(rs)])),
  }]));
}

// Elasticsearch summary: terms per room and zone, median speed and latency (percentiles 50), last reading time.
async function esSummary() {
  const { es: client, INDEX } = es();
  const metricsAgg = {
    mbps: { percentiles: { field: 'download_mbps', percents: [50] } },
    ms: { percentiles: { field: 'latency_ms', percents: [50] } },
    last: { max: { field: 'at' } },
    labels: { terms: { field: 'label', size: 5 } },
  };
  const r = await client().search({
    index: INDEX.wifi_readings, size: 0,
    aggs: { rooms: { terms: { field: 'space_id', size: 500 }, aggs: { ...metricsAgg, zones: { terms: { field: 'zone', size: 20 }, aggs: metricsAgg } } } },
  });
  const one = (b) => {
    const mbps = b.mbps.values['50.0'] ?? null;
    // 'real' counts as live for the on-screen label
    const label = labelOf(b.labels.buckets.map((l) => (l.key === 'stand_in' ? 'stand_in' : 'live')));
    return { mbps: mbps == null ? null : Math.round(mbps), ms: b.ms.values['50.0'] == null ? null : Math.round(b.ms.values['50.0']), count: b.doc_count, last: b.last.value || null, band: band(mbps), label };
  };
  return Object.fromEntries(r.aggregations.rooms.buckets.map((b) => [b.key, {
    ...one(b),
    zones: Object.fromEntries(b.zones.buckets.map((z) => [z.key, one(z)])),
  }]));
}

// shortcut: the Elasticsearch summary is cached for 30 s and refreshed in the background, so /api/floors stays
// synchronous; move to a push model if readings must show up faster than that.
const cache = { at: 0, rooms: null, pending: null };
function refresh() {
  if (!hasEs() || cache.pending || Date.now() - cache.at < 30_000) return;
  cache.pending = esSummary()
    .then((rooms) => { cache.rooms = rooms; cache.at = Date.now(); })
    .catch((e) => { cache.at = Date.now(); console.warn(`[wifi] summary from Elasticsearch failed: ${e.message}`); })
    .finally(() => { cache.pending = null; });
}

// Per-room figures for floor tiles. Elasticsearch when it has the room, memory otherwise.
function roomStats(db, id) {
  refresh();
  const fromEs = cache.rooms?.[id];
  if (fromEs) return { mbps: fromEs.mbps, ms: fromEs.ms, count: fromEs.count, band: fromEs.band, source: 'elasticsearch', label: fromEs.label };
  const rs = db.wifi.filter((w) => w.space === id);
  if (!rs.length) return null;
  const s = stat(rs);
  return { mbps: s.mbps, ms: s.ms, count: s.count, band: s.band, source: 'memory', label: s.label };
}

// Per-zone figures for one room (heatmap). Elasticsearch when it has the room, memory otherwise.
function zoneStats(db, id) {
  refresh();
  const fromEs = cache.rooms?.[id];
  if (fromEs) return { source: 'elasticsearch', zones: fromEs.zones };
  return { source: 'memory', zones: summarize(db.wifi.filter((w) => w.space === id))[id]?.zones || {} };
}

async function summary(db) {
  if (hasEs()) {
    try { return { source: 'elasticsearch', rooms: await esSummary() }; }
    catch (e) { console.warn(`[wifi] summary from Elasticsearch failed, using memory: ${e.message}`); }
  }
  return { source: 'memory', rooms: summarize(db.wifi) };
}

module.exports = { band, labelOf, record, summarize, summary, roomStats, zoneStats, toDoc, hasEs };

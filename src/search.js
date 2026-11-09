// Session search (A4, S1). With ELASTICSEARCH_URL it runs one hybrid query on P1's sessions index (src/es.js);
// otherwise, or if Elasticsearch fails, a small in-memory text match over the live rooms.
// Every result says why it matched. Interests are only a filter (`mine`), never a ranking signal.
const { predictFill } = require('./forecast');
const { HISTORY } = require('./mock/history');
const { SESSIONS } = require('./mock/insights-seed');

const RISK = Object.fromEntries(SESSIONS.map((s) => [s.room, predictFill(s, HISTORY).risk]));
const SOON_MS = 30 * 60 * 1000;

// Lower-case word tokens with a trailing plural "s" dropped, so "talks" finds "talk".
const tokens = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).map((t) => (t.length > 3 ? t.replace(/s$/, '') : t));

function memorySearch(rooms, q) {
  const terms = tokens(q);
  if (!terms.length) return rooms.map((r) => ({ r, score: 0, why: [] }));
  const out = [];
  for (const r of rooms) {
    const fields = [['title', tokens(r.title), 3], ['tags', tokens((r.tags || []).join(' ')), 2], ['room', tokens(r.id), 2]];
    let score = 0;
    const why = [];
    for (const t of terms) {
      // A term matches a field word that starts with it, so "obs" finds "observability".
      const hit = fields.find(([, words]) => words.some((w) => w.startsWith(t)));
      if (hit) { score += hit[2]; why.push(`matches "${t}" in ${hit[0]}`); }
    }
    if (score) out.push({ r, score, why });
  }
  return out;
}

// P1 owns the index and mappings; this only reads it. Sessions carry room_id like "r204"; the engine's id is "204".
async function esSearch(q, size = 50) {
  const { es, INDEX, SEMANTIC } = require('./es');
  const should = [{ multi_match: { query: q, fields: ['title^3', 'tags^2', 'abstract'], fuzziness: 'AUTO' } }];
  if (SEMANTIC) should.push({ semantic: { field: 'topic', query: q } });
  const res = await es().search({
    index: INDEX.sessions,
    size,
    query: { bool: { should, minimum_should_match: 1 } },
    highlight: { fields: { title: {}, abstract: {}, tags: {} } },
    _source: ['room_id', 'title', 'start', 'end', 'tags'],
  });
  return res.hits.hits.map((h) => {
    const fields = Object.keys(h.highlight || {});
    return {
      room: String(h._source.room_id || '').replace(/^r/, ''),
      title: h._source.title,
      start: h._source.start,
      end: h._source.end,
      score: h._score,
      why: fields.length ? fields.map((f) => `matches "${q}" in ${f}`) : [`about "${q}" (meaning, not exact words)`],
    };
  });
}

let warned = false;

async function search(engine, user, p) {
  const t0 = Date.now();
  const rooms = engine.floors(user?.role).flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.floor, tags: engine.space(r.id)?.tags || [] })));
  let source = 'memory';
  let list = null;

  if (p.q && process.env.ELASTICSEARCH_URL) {
    try {
      const hits = await esSearch(p.q);
      const byId = new Map(rooms.map((r) => [r.id, r]));
      const seen = new Set();
      list = [];
      // Several sessions can share a room; keep its best hit.
      for (const h of hits) {
        const r = byId.get(h.room);
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        list.push({ r, score: h.score, why: h.why, startsAt: h.start, endsAt: h.end, sessionTitle: h.title });
      }
      source = 'elasticsearch';
    } catch (e) {
      if (!warned) { warned = true; console.warn('[search] Elasticsearch unavailable, using the in-memory search:', e.message); }
      list = null;
    }
  }
  if (!list) list = memorySearch(rooms, p.q);

  const now = Date.now();
  const interests = user?.interests || [];
  // shortcut: in-memory rooms carry no session times, so they count as running now; real times come from Elasticsearch.
  const isSoon = (x) => !x.startsAt || (Date.parse(x.startsAt) <= now + SOON_MS && (!x.endsAt || Date.parse(x.endsAt) >= now));
  const kept = list.filter((x) => {
    const { r } = x;
    if (p.floor != null && r.floor !== p.floor) return false;
    if (p.stepFree && !r.stepFree) return false;
    if (p.free && !(r.free > 0)) return false;
    if (p.status && r.status !== p.status) return false;
    if (p.mine && !r.tags.some((t) => interests.includes(t))) return false;
    if (p.soon && !isSoon(x)) return false;
    return true;
  });
  kept.sort((a, b) => b.score - a.score || b.r.free - a.r.free);

  const results = kept.slice(0, p.limit).map((x) => {
    const { r } = x;
    const why = [...x.why];
    if (p.stepFree) why.push('step-free');
    if (p.free) why.push(`${r.free} seats free now`);
    if (p.status) why.push(`status is ${r.status}`);
    if (p.mine) why.push('matches your interests');
    if (p.soon) why.push(x.startsAt ? 'starts within 30 minutes or is on now' : 'on now');
    if (p.floor != null) why.push(`on floor ${r.floor}`);
    const out = {
      room: r.id, sessionTitle: x.sessionTitle || r.title, floor: r.floor, status: r.status, taken: r.taken, capacity: r.capacity, free: r.free,
      stepFree: r.stepFree, access: r.access, startsAt: x.startsAt || null, risk: RISK[r.id] || null, why, score: x.score,
    };
    if ('staffOn' in r) Object.assign(out, { staffOn: r.staffOn, queue: r.queue });
    return out;
  });
  return { source, query: p, results, took: Date.now() - t0 };
}

module.exports = { search, memorySearch, esSearch, tokens };

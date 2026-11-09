// Seeds RightRoom's indexes with the stand-in event (P1).
//
//   node scripts/seed.js            create missing indexes, then write the seed documents (safe to rerun:
//                                   fixed document IDs, so a rerun overwrites instead of duplicating)
//   node scripts/seed.js --reset    delete every index with this prefix first. On the live prefix (rr_) this wipes
//                                   real users, queues and check-ins, so it also needs --confirm-live.
//
// Reads ELASTICSEARCH_URL / ELASTICSEARCH_API_KEY / ES_INDEX_PREFIX from the environment or .env.
// Session times are relative to now, so there is always a session running and one about to start.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { es, INDEX, PREFIX, SEMANTIC, ensureIndexes, dropIndexes } = require('../src/es');
const data = require('./seed-data.json');

const EVENT = data.event.id;
const LABEL = 'stand_in';
const MIN = 60 * 1000;
// Decision 32 defaults; the organiser or the room's staff can change them per session.
const DOOR_OPENS_BEFORE_MIN = 10;
const DOOR_CLOSES_AFTER_MIN = 20;

function statusFor(taken, capacity) {
  if (taken >= capacity) return 'full';
  if (taken >= 0.8 * capacity) return 'filling';
  return 'seats_free';
}

// Walking minutes between rooms: corridor distance plus 2 minutes per floor by lift.
// The route is step-free when the destination room is (every floor has a lift).
function walk(from, to) {
  const minutes = Math.max(1, Math.abs(from.x - to.x) + 2 * Math.abs(from.floor - to.floor));
  return { to: to.id, minutes, step_free: !!to.step_free };
}

// Front / Middle / Back, splitting capacity and the current count evenly, front first.
function zones(capacity, taken) {
  const names = ['Front', 'Middle', 'Back'];
  const cap = names.map((_, i) => Math.floor(capacity / 3) + (i < capacity % 3 ? 1 : 0));
  let left = taken;
  return names.map((name, i) => {
    const t = Math.min(cap[i], left);
    left -= t;
    return { name, capacity: cap[i], taken: t };
  });
}

function buildDocs(now) {
  const stamp = { event_id: EVENT, label: LABEL, created_at: now.toISOString(), updated_at: now.toISOString() };
  const docs = []; // [index, id, body]
  const v = data.venue;

  docs.push([INDEX.spaces, v.id, {
    ...stamp, type: 'venue', name: v.name, floor: 1, capacity: v.capacity, taken: v.taken,
    staff_correction: v.taken, status: statusFor(v.taken, v.capacity), status_source: 'auto',
    rule: v.rule, priorities: ['access_needs'], step_free: true, captions: false,
  }]);

  for (const r of data.rooms) {
    docs.push([INDEX.spaces, r.id, {
      ...stamp, type: 'room', name: r.name, floor: r.floor, capacity: r.capacity, taken: r.taken,
      // Stand-in count: there are no real check-ins yet, so the whole count sits in the staff correction.
      staff_correction: r.taken, access_seats: r.access_seats, access_taken: 0,
      status: statusFor(r.taken, r.capacity), status_source: 'auto',
      rule: data.rule_room, priorities: r.access_seats ? ['access_needs'] : [],
      step_free: r.step_free, captions: r.captions, overflow_space_id: r.overflow_space_id,
      stream_url: `/stream/${r.id}`,
      zones: zones(r.capacity, r.taken),
      walks: data.rooms.filter((o) => o.id !== r.id).map((o) => walk(r, o)),
    }]);
  }

  const slots = Object.fromEntries(data.slots.map((s) => [s.id, s]));
  for (const s of data.sessions) {
    const slot = slots[s.slot];
    const start = new Date(now.getTime() + slot.start_min * MIN);
    const end = new Date(start.getTime() + slot.duration_min * MIN);
    docs.push([INDEX.sessions, `s-${s.room}-${s.slot}`, {
      ...stamp, title: s.title, abstract: s.abstract, speakers: [], tags: s.tags, track: s.track,
      level: s.level, room_id: s.room, start: start.toISOString(), end: end.toISOString(),
      door_open_at: new Date(start.getTime() - DOOR_OPENS_BEFORE_MIN * MIN).toISOString(),
      door_close_at: new Date(start.getTime() + DOOR_CLOSES_AFTER_MIN * MIN).toISOString(),
      topic: `${s.title}. ${s.abstract} Tags: ${s.tags.join(', ')}.`,
    }]);
  }

  for (const q of data.queues) {
    q.handles.forEach((handle, i) => {
      const needs = q.needs[handle] || [];
      docs.push([INDEX.queue, `q-${q.space}-${i + 1}`, {
        ...stamp, space_id: q.space, handle, position: i + 1,
        arrived_at: new Date(now.getTime() - (q.handles.length - i) * MIN).toISOString(),
        needs, priority: needs.length > 0, status: 'waiting',
        reason: 'In order of arrival at the door.',
      }]);
    });
  }
  return docs;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const now = new Date();
  console.log(`Seeding prefix "${PREFIX}" (semantic ${SEMANTIC ? 'on' : 'off'})${reset ? ' after reset' : ''}`);

  if (reset && PREFIX === 'rr_' && !process.argv.includes('--confirm-live')) {
    throw new Error('--reset on the live prefix rr_ deletes real data; add --confirm-live, or set ES_INDEX_PREFIX to a test prefix');
  }
  if (reset) await dropIndexes();
  const created = await ensureIndexes();
  if (created.length) console.log('Created indexes:', created.join(', '));

  const docs = buildDocs(now);
  const operations = docs.flatMap(([index, id, body]) => [{ index: { _index: index, _id: id } }, body]);
  // The first semantic_text write can wait for the inference model to start, so allow a long timeout.
  const res = await es().bulk({ operations, refresh: 'wait_for' }, { requestTimeout: 180000 });
  if (res.errors) {
    const failed = res.items.map((it) => it.index).filter((it) => it.error);
    for (const f of failed.slice(0, 5)) console.error(`  ${f._index}/${f._id}: ${f.error.type}: ${f.error.reason}`);
    throw new Error(`${failed.length} of ${docs.length} documents failed`);
  }

  const count = (index) => docs.filter((d) => d[0] === index).length;
  console.log(`Wrote ${count(INDEX.spaces)} spaces, ${count(INDEX.sessions)} sessions, ${count(INDEX.queue)} queue entries (label: ${LABEL}).`);
  const full = data.rooms.filter((r) => r.taken >= r.capacity).map((r) => r.name);
  console.log(`Full now: ${full.join(', ') || 'none'}. Try: node scripts/try-redirect.js r204`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Seed failed:', e?.meta?.body?.error?.reason || e.message);
    process.exit(1);
  });
}

module.exports = { buildDocs, statusFor, walk, zones };

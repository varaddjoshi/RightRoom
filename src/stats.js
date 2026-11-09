// Staff and floor aggregations (P1). P2's routes call these; they only read.
//
// floors({ staff, now })  rooms grouped by floor for GET /api/floors. With staff = true each room also gets
//                         queue length, open offers, whether a staff console is open, and accessibility seats left.
// zoneFill(spaceId)       check-ins per zone in one room, for the zone grid and big screen.

const { es, INDEX } = require('./es');
const clock = require('./clock');

async function currentTitles(roomIds, now) {
  if (!roomIds.length) return {};
  const res = await es().search({
    index: INDEX.sessions,
    size: roomIds.length * 2,
    query: { bool: { filter: [
      { terms: { room_id: roomIds } },
      { range: { start: { lte: now.toISOString() } } },
      { range: { end: { gt: now.toISOString() } } },
    ] } },
    _source: ['room_id', 'title', 'end'],
  });
  return Object.fromEntries(res.hits.hits.map((h) => [h._source.room_id, { session_id: h._id, title: h._source.title, end: h._source.end }]));
}

// Counts per space_id for documents matching `status`.
async function countBySpace(index, status) {
  const res = await es().search({
    index,
    size: 0,
    query: { term: { status } },
    aggs: { by_space: { terms: { field: 'space_id', size: 500 } } },
  });
  return Object.fromEntries(res.aggregations.by_space.buckets.map((b) => [b.key, b.doc_count]));
}

function accessNote(room) {
  const parts = [room.step_free ? 'Step-free' : 'Stairs only'];
  if (room.captions) parts.push('live captions');
  if (room.access_seats) parts.push(`${room.access_seats} accessibility seats`);
  return parts.join(', ');
}

async function floors({ staff = false, now = clock.now() } = {}) {
  const res = await es().search({
    index: INDEX.spaces,
    size: 500,
    query: { term: { type: 'room' } },
    sort: [{ floor: 'asc' }, { 'name.raw': 'asc' }],
    _source: { excludes: ['walks'] },
  });
  const rooms = res.hits.hits.map((h) => ({ id: h._id, ...h._source }));
  const [titles, queued, offered] = await Promise.all([
    currentTitles(rooms.map((r) => r.id), now),
    staff ? countBySpace(INDEX.queue, 'waiting') : {},
    staff ? countBySpace(INDEX.offers, 'offered') : {},
  ]);

  const byFloor = new Map();
  for (const r of rooms) {
    const item = {
      id: r.id,
      name: r.name,
      session: titles[r.id] || null,
      capacity: r.capacity,
      taken: r.taken,
      free: Math.max(0, (r.capacity || 0) - (r.taken || 0)),
      status: r.status,
      access_note: accessNote(r),
      label: r.label || 'live',
    };
    if (staff) {
      item.queue_length = queued[r.id] || 0;
      item.open_offers = offered[r.id] || 0;
      item.staff_on_door = !!(r.staff_console_open_until && new Date(r.staff_console_open_until) > now);
      item.access_seats_left = Math.max(0, (r.access_seats || 0) - (r.access_taken || 0));
      item.needs_staff = r.status !== 'free' && !item.staff_on_door;
    }
    if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
    byFloor.get(r.floor).push(item);
  }
  return {
    floors: [...byFloor.entries()].sort((a, b) => b[0] - a[0]).map(([floor, list]) => ({ floor, rooms: list })),
    generated_at: now.toISOString(),
  };
}

async function zoneFill(spaceId) {
  const [space, res] = await Promise.all([
    es().get({ index: INDEX.spaces, id: spaceId, _source: ['zones', 'capacity', 'taken'] }),
    es().search({
      index: INDEX.checkins,
      size: 0,
      query: { term: { space_id: spaceId } },
      aggs: { by_zone: { terms: { field: 'zone', size: 20 } } },
    }),
  ]);
  const checkedIn = Object.fromEntries(res.aggregations.by_zone.buckets.map((b) => [b.key, b.doc_count]));
  return (space._source.zones || []).map((z) => ({
    name: z.name,
    capacity: z.capacity,
    taken: z.taken,
    checked_in: checkedIn[z.name] || 0,
  }));
}

module.exports = { floors, zoneFill, accessNote };

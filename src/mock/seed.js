// Example data matching public/mockups/screen-map.html. Stand-in people are flagged so screens can label them.
const ZONES = ['front-left', 'front-centre', 'front-right', 'middle-left', 'middle-centre', 'middle-right', 'back-left', 'back-centre', 'back-right'];

const ROOMS = [
  { id: '305', floor: 3, pos: 1, capacity: 60, title: 'Supply chain security', tags: ['security', 'kubernetes'], stepFree: false, access: 'Stairs only · captions', captions: true, inside: 60 },
  { id: '310', floor: 3, pos: 2, capacity: 40, title: 'Helm workshop', tags: ['helm', 'kubernetes'], stepFree: true, access: 'Step-free', inside: 12 },
  { id: '204', floor: 2, pos: 1, capacity: 50, title: 'eBPF deep dive', tags: ['ebpf', 'observability'], stepFree: true, access: 'Step-free via east lift', inside: 50 },
  { id: '210', floor: 2, pos: 2, capacity: 40, title: 'Observability at scale', tags: ['observability', 'kubernetes'], stepFree: true, access: 'Step-free', inside: 31 },
  { id: '220', floor: 2, pos: 3, capacity: 40, title: 'Lightning talks', tags: ['kubernetes', 'observability', 'platform'], stepFree: true, access: 'Step-free', inside: 34 },
  { id: '118', floor: 1, pos: 1, capacity: 50, title: 'Rust in the kernel', tags: ['rust', 'ebpf'], stepFree: true, access: 'Step-free', inside: 41 },
  { id: '101', floor: 1, pos: 2, capacity: 300, title: 'Keynote hall', tags: ['kubernetes', 'platform'], stepFree: true, access: 'Step-free', inside: 120 },
];

function seed(now = Date.now()) {
  const spaces = new Map();
  spaces.set('venue', {
    id: 'venue', type: 'venue', floor: 0, title: 'Venue · Hall A', capacity: 180,
    rule: 'Admitted in order of registration. 6 places are held for stated access needs, listed publicly.',
    doorsOpen: now,
  });
  const checkins = new Map();
  for (const r of ROOMS) {
    spaces.set(r.id, {
      ...r, type: 'room', inside: undefined,
      rule: 'Seats go first come, within accessibility fit.',
      accessZones: r.stepFree ? ['front-left'] : [],
      correction: 0, freeZones: [], override: null, confirmed: r.inside >= r.capacity, pending: null, staffOn: null, redirectHolds: [],
    });
    const m = new Map();
    for (let i = 0; i < r.inside; i++) m.set(`stand-in-${r.id}-${i}`, { zone: ZONES[i % 9], at: now, standIn: true });
    checkins.set(r.id, m);
  }
  const queue = [];
  // Venue already holds 171 stand-in registrations, so the next person is admitted.
  for (let i = 0; i < 171; i++) queue.push({ id: `q-venue-${i}`, space: 'venue', handle: `stand-in-reg-${i}`, needs: [], at: now - 1, status: 'admitted', admittedAt: now, scannedIn: true, standIn: true });
  return {
    spaces, checkins, queue,
    offers: new Map(),
    users: new Map(),
    announcements: [
      { id: 1, text: 'West lift is out of service. Use the east lift for step-free access.', floor: 2, urgency: 'urgent', at: now },
      { id: 2, text: 'Lunch is in the atrium from 12:00.', floor: null, urgency: 'info', at: now - 1 },
      { id: 3, text: 'Room 305 has live captions all day.', floor: 3, urgency: 'info', at: now - 2 },
    ],
    comments: [],
    wifi: [],
    seq: 0,
  };
}

module.exports = { seed, ZONES };

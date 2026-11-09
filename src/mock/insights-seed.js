// Stand-in data for forecast, Wi-Fi, topics, interests and metrics. Rooms match the screen map and
// src/mock/seed.js; Wi-Fi readings and comments use the same record shapes as db().wifi and
// db().comments ({space, zone, mbps, ms, at} and {id, space, text, at, hidden}). Every record is labelled stand-in.
const { prng } = require('./history');

const S = 'stand-in';
const ZONES = ['front-left', 'front-centre', 'front-right', 'middle-left', 'middle-centre', 'middle-right', 'back-left', 'back-centre', 'back-right'];

const SESSIONS = [
  { room: '204', floor: 2, title: 'eBPF deep dive', capacity: 50, tags: ['ebpf', 'observability'], slot: 'morning', keynoteAdjacent: false },
  { room: '210', floor: 2, title: 'Observability at scale', capacity: 40, tags: ['observability', 'kubernetes'], slot: 'morning', keynoteAdjacent: false },
  { room: '220', floor: 2, title: 'Lightning talks', capacity: 40, tags: ['kubernetes', 'observability', 'platform'], slot: 'morning', keynoteAdjacent: false },
  { room: '118', floor: 1, title: 'Rust in the kernel', capacity: 50, tags: ['rust', 'ebpf'], slot: 'morning', keynoteAdjacent: true },
  { room: '101', floor: 1, title: 'Keynote hall', capacity: 300, tags: ['kubernetes', 'platform'], slot: 'morning', keynoteAdjacent: true },
  { room: '305', floor: 3, title: 'Supply chain security', capacity: 60, tags: ['security', 'kubernetes'], slot: 'morning', keynoteAdjacent: false },
  { room: '310', floor: 3, title: 'Helm workshop', capacity: 40, tags: ['helm', 'kubernetes'], slot: 'afternoon', keynoteAdjacent: false },
].map(s => ({ ...s, source: S }));

// Wi-Fi: 2 readings per zone per room, 3 for 204 and 210 (about 150). Typical Mbps per room.
const BASE = { 204: 24, 210: 48, 220: 30, 118: 18, 101: 35, 305: 15, 310: 40 };
const rand = prng(42);
const WIFI = [];
for (const s of SESSIONS) {
  for (const zone of ZONES) {
    const n = s.room === '204' || s.room === '210' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const weak = s.room === '204' && zone === 'back-left'; // the dead spot from the scenarios
      const mbps = weak ? 3 + Math.round(rand() * 2) : Math.round(BASE[s.room] * (0.7 + rand() * 0.6));
      WIFI.push({ space: s.room, zone, mbps, ms: weak ? 180 + Math.round(rand() * 80) : 25 + Math.round(rand() * 40), at: Date.parse(`2026-11-09T${10 + (i % 3)}:${String(5 + i * 11).padStart(2, '0')}:00Z`), standIn: true, source: S });
    }
  }
}

// Comments: no handle kept (decision 12).
const C = (space, texts) => texts.map((text, i) => ({ space, text, at: Date.parse('2026-11-09T11:50:00Z') + i * 60000, hidden: false, standIn: true, source: S }));
const COMMENTS = [
  ...C('204', [
    'Slides too small to read from the back rows.',
    'Slides too small, could not read the code samples.',
    'The verifier section was the best part.',
    'Loved the verifier limits walkthrough.',
    'More on tracing with bpftrace please.',
    'Great tracing demo, slides too small though.',
    'Wi-Fi died at the back left so the live demo froze for me.',
    'Verifier errors finally make sense.',
    'Tracing examples were really practical.',
    'Room was packed, glad I got a seat.',
  ]),
  ...C('210', [
    'Clear intro to OpenTelemetry collectors.',
    'OpenTelemetry collectors explained well.',
    'Sampling strategies part was useful.',
    'Wanted more on sampling strategies for logs.',
    'Dashboards examples were great.',
    'Good pace, good dashboards.',
    'Plenty of seats, easy to get in.',
    'Would like the slides shared.',
  ]),
  ...C('220', [
    'Lightning format kept energy high.',
    'Too many talks back to back.',
    'Best one was the platform golden paths talk.',
    'Golden paths talk was gold.',
    'Mic volume too low at the start.',
    'Mic volume fixed after the first talk.',
    'Fun session.',
    'Short talks, good variety.',
  ]),
  ...C('118', [
    'Rust for Linux status update was great.',
    'Memory safety arguments were convincing.',
    'Memory safety part was the highlight.',
    'Room got warm, air conditioning please.',
    'Air conditioning was off at the start.',
    'Needed more seats at the back.',
    'Rust for Linux demo worked first time.',
    'Good questions from the audience.',
  ]),
  ...C('101', [
    'Keynote ran ten minutes over.',
    'Keynote ran over and we missed the start of the next talk.',
    'Captions on the big screen helped a lot.',
    'Captions were accurate.',
    'Great announcements about the roadmap.',
    'Roadmap slides were exciting.',
    'Huge hall, easy to find a seat.',
    'Sound was clear everywhere.',
  ]),
  ...C('305', [
    'Stairs only made this hard to reach.',
    'Stairs only, please list step-free routes.',
    'SBOM tooling comparison was useful.',
    'SBOM tooling demo was great.',
    'Signing with Sigstore explained clearly.',
    'Sigstore section was the best.',
    'Full before it started, got turned away.',
    'Live captions worked well.',
  ]),
  ...C('310', [
    'Helm chart testing tips were handy.',
    'Chart testing exercise was fun.',
    'Workshop wifi was solid.',
    'Laptop power sockets were too few.',
    'Power sockets ran out quickly.',
    'Helm 4 preview was a nice surprise.',
    'Good hands on pace.',
    'Instructor answered every question.',
  ]),
];

// Interests: 200 stand-in users. Tag counts are exact so S1 shows the numbers in the scenarios.
const COUNTS = { observability: 52, kubernetes: 44, ebpf: 37, security: 21, rust: 12, 'platform-eng': 9, helm: 3, wasm: 2 };
const USERS = Array.from({ length: 200 }, (_, i) => ({ handle: `stand-in-${i + 1}`, interests: [], source: S }));
Object.entries(COUNTS).forEach(([tag, n], k) => {
  for (let m = 0; m < n; m++) USERS[(k * 37 + m * 7) % 200].interests.push(tag); // 7 and 200 are coprime, so no repeats
});
const TAG_LABELS = { observability: 'Observability', kubernetes: 'Kubernetes', ebpf: 'eBPF', security: 'Security', rust: 'Rust', 'platform-eng': 'Platform eng', helm: 'Helm', wasm: 'Wasm' };

// Event log behind the proof numbers: 23 redirects (17 followed within 15 min), 14 Full prompts (1 overridden).
const LOG = [
  ...Array.from({ length: 23 }, (_, i) => ({ type: 'redirect', from: i % 3 ? '204' : '305', to: i % 4 ? '210' : '220', followed: i < 17, minutes: i < 17 ? 2 + (i % 9) : null, source: S })),
  ...Array.from({ length: 14 }, (_, i) => ({ type: 'full_prompt', room: ['204', '305', '118'][i % 3], answer: i === 5 ? 'not_yet' : i % 4 === 0 ? 'timeout' : 'confirm', source: S })),
];

// Extras as data only.
const TABLES = [
  { id: 'T1', type: 'table', floor: 2, label: 'Table 1, floor 2 near the coffee', capacity: 4, taken: 4, stepFree: true, source: S },
  { id: 'T2', type: 'table', floor: 2, label: 'Table 2, floor 2 by the window', capacity: 4, taken: 2, stepFree: true, source: S },
  { id: 'T3', type: 'table', floor: 2, label: 'Table 3, floor 2 quiet corner', capacity: 4, taken: 1, stepFree: false, source: S },
  { id: 'T4', type: 'table', floor: 2, label: 'Table 4, floor 2 by the sockets', capacity: 4, taken: 3, stepFree: true, source: S },
];
const ALERTS = [
  { handle: 'blue-otter', need: 'A step-free seat in Room 204', matches: { room: '204', stepFree: true }, source: S },
  { handle: 'red-fox', need: 'A table for 2 on floor 2', matches: { type: 'table', floor: 2, seats: 2 }, source: S },
  { handle: 'quiet-heron', need: 'Any seat near captions', matches: { captions: true }, source: S },
];
const SOLO = [
  { handle: 'green-lynx', interests: ['ebpf', 'rust'], lookingFor: 'Someone to pair on the eBPF lab', source: S },
  { handle: 'amber-owl', interests: ['observability'], lookingFor: 'A team for the tracing workshop', source: S },
  { handle: 'slate-crow', interests: ['ebpf', 'observability'], lookingFor: 'Lunch with other eBPF folks', source: S },
  { handle: 'coral-seal', interests: ['helm', 'platform'], lookingFor: 'Platform team chat', source: S },
];

// Append the stand-in readings and comments to a Phase 1 store: seedInto(store.db).
// Call it again after store.reset(), which rebuilds the db empty.
function seedInto(db) {
  for (const w of WIFI) db.wifi.push({ ...w });
  for (const c of COMMENTS) db.comments.push({ ...c, id: ++db.seq });
  return db;
}

// The fixed stand-ins above use the demo room ids, so rooms loaded from Elasticsearch (the real schedule) get none.
// This gives every room that has no Wi-Fi, heat or comments its own stand-ins, and adds stand-in attendees
// (no password, so nobody can sign in as one; the 'stand-in' prefix is reserved at sign-up). Safe to rerun.
const GENERIC = ['Great talk, clear slides.', 'Slides too small from the back.', 'Room got warm.', 'Wi-Fi was patchy at the back.',
  'Would like the slides shared.', 'Good questions from the audience.', 'Ran a few minutes over.', 'Easy to find a seat.'];
const NEEDS = ['step-free', 'captions', 'aisle', 'quiet', 'front', 'hearing-loop'];
const STAND_IN_USERS = 120;

function fillStandIns(db, now = Date.now()) {
  const r = prng(99);
  const heat = (db.heatStandIns ??= new Map());
  for (const sp of db.spaces.values()) {
    if (sp.type !== 'room' || sp.test) continue;
    if (!db.wifi.some((w) => w.space === sp.id)) {
      const base = 10 + r() * 45; // typical Mbps for this room
      for (const zone of ZONES) for (let i = 0; i < 2; i++) {
        const weak = zone.startsWith('back') && r() < 0.3;
        db.wifi.push({ space: sp.id, zone, floor: sp.floor, mbps: Math.round(weak ? 2 + r() * 5 : base * (0.7 + r() * 0.6)),
          ms: Math.round(weak ? 150 + r() * 100 : 20 + r() * 40), at: now - Math.round(r() * 3600_000), standIn: true, source: S });
      }
    }
    // Heatmap only (never taken seats): fronts fuller than backs, capped at each zone's share of the room.
    if (!heat.has(sp.id) && !db.checkins.get(sp.id)?.size) {
      const m = new Map(), per = Math.max(1, Math.ceil(sp.capacity / ZONES.length)), fill = 0.3 + r() * 0.6;
      for (const zone of ZONES) {
        const n = Math.min(per, Math.round(per * fill * { front: 1.3, middle: 1, back: 0.6 }[zone.split('-')[0]]));
        for (let i = 0; i < n; i++) m.set(`stand-in-zone-${sp.id}-${zone}-${i}`, { zone, at: now, standIn: true });
      }
      heat.set(sp.id, m);
    }
    if (!db.comments.some((c) => c.space === sp.id)) {
      for (let i = 0; i < 4; i++) db.comments.push({ id: ++db.seq, space: sp.id, text: GENERIC[Math.floor(r() * GENERIC.length)], at: now - i * 60000, hidden: false, standIn: true, source: S });
    }
  }
  const tags = Object.keys(COUNTS);
  for (let i = 1; i <= STAND_IN_USERS; i++) {
    const handle = `stand-in-user-${i}`;
    if (db.users.has(handle)) continue;
    const interests = [...new Set([tags[Math.floor(r() * r() * tags.length)], tags[Math.floor(r() * tags.length)]])];
    db.users.set(handle, { handle, role: 'attendee', interests, needs: r() < 0.15 ? [NEEDS[Math.floor(r() * NEEDS.length)]] : [], starred: [], standIn: true });
  }
  return db;
}

module.exports = { ZONES, SESSIONS, WIFI, COMMENTS, USERS, TAG_LABELS, LOG, TABLES, ALERTS, SOLO, seedInto, fillStandIns };

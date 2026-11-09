// Imports a real event schedule from a public Sessionize Markdown feed into seed data (P1, decision 25).
//
//   node scripts/import-sessionize.js [feedId] [out.json]
//   default feed: KubeCon + CloudNativeCon North America 2026, Salt Lake City (uo948i5p)
//
// Keeps talks (sessions with speakers); skips registration, breaks, meals and other logistics.
// Real: titles, descriptions, speakers, times, rooms and levels. Stand-in (the feed doesn't publish them):
// room capacities and walking times. Tags are derived from keywords in the title and description.

const fs = require('fs');
const path = require('path');

const FEED = process.argv[2] || 'uo948i5p';
const OUT = process.argv[3] || path.join(__dirname, 'seed-data.kubecon.json');
const BASE = `https://sessionize.com/api/v2/${FEED}/view/markdown`;
const CONCURRENCY = 4;

// Keyword -> tag. Interests match tags; the topic match itself uses the full text (ELSER).
const TAGS = {
  kubernetes: /\bkubernetes\b|\bk8s\b/i,
  ai: /\b(ai|llm|llms|genai|machine learning|ml|model|models|agentic|agents?|inference|rag)\b/i,
  gpu: /\bgpus?\b|\baccelerators?\b/i,
  observability: /observability|opentelemetry|\botel\b|tracing|metrics|logging|prometheus|monitoring/i,
  security: /security|secure|vulnerab|zero[- ]trust|supply chain|sbom|sigstore|policy|authn|authz|identity/i,
  networking: /network|service mesh|istio|envoy|gateway api|cilium|\bdns\b/i,
  ebpf: /\bebpf\b/i,
  platform: /platform engineering|internal developer|developer portal|backstage|golden path|developer experience/i,
  gitops: /gitops|argo ?cd|flux/i,
  storage: /storage|\bcsi\b|database|stateful/i,
  scaling: /autoscal|scaling|\bkeda\b|karpenter|scheduler|scheduling/i,
  wasm: /wasm|webassembly/i,
  edge: /\bedge\b|\biot\b/i,
  sustainability: /sustainab|carbon|energy/i,
  reliability: /reliability|\bsre\b|chaos|incident|resilien/i,
  'ci-cd': /\bci\/cd\b|continuous delivery|pipeline|tekton/i,
};

const SKIP_TITLE = /registration|badge|coffee|lunch|breakfast|break|coat|lounge|reception|expo|happy hour|quiet room|prayer|wellness|first aid|lactation|sign-?in|closing remarks|opening remarks/i;

const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

function toIso(dateHeading, time, offset) {
  // dateHeading "Tuesday, November 10, 2026", time "10:29 am"
  const m = dateHeading.match(/(\w+) (\d{1,2}), (\d{4})/);
  const t = time.trim().match(/(\d{1,2}):(\d{2}) ?(am|pm)/i);
  if (!m || !t) return null;
  let h = Number(t[1]) % 12;
  if (t[3].toLowerCase() === 'pm') h += 12;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(MONTHS[m[1]])}-${pad(m[2])}T${pad(h)}:${t[2]}:00${offset}`;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function parseIndex(md) {
  const tz = md.match(/\*\*Timezone:\*\*[^\n]*UTC([+-]\d{2})/);
  const offset = tz ? `${tz[1]}:00` : 'Z';
  const name = (md.match(/^# (.+)$/m) || [])[1];
  const location = (md.match(/\*\*Location:\*\* (.+)$/m) || [])[1];
  const sessionsPart = md.split(/^## Speakers/m)[0];
  const out = [];
  let day = null;
  const lines = sessionsPart.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### (.+)$/);
    if (h) { day = h[1]; continue; }
    const s = lines[i].match(/^- \[(.+)\]\(.*\/session\/(\d+)\)\s*$/);
    if (!s || !day) continue;
    const detail = (lines[i + 1] || '').trim();
    // "[speakers · ]9:00 am - 9:31 am · Room"
    const parts = detail.split(' · ');
    const timeIdx = parts.findIndex((p) => /\d{1,2}:\d{2} ?(am|pm) - \d{1,2}:\d{2} ?(am|pm)/i.test(p));
    if (timeIdx < 0) continue;
    const [from, to] = parts[timeIdx].split(' - ');
    out.push({
      id: s[2],
      title: s[1].replace(/\\([\[\]])/g, '$1'),
      speakers: timeIdx > 0 ? parts.slice(0, timeIdx).join(' · ').split(/,\s*/) : [],
      start: toIso(day, from, offset),
      end: toIso(day, to, offset),
      room: parts.slice(timeIdx + 1).join(' · ').trim(),
    });
  }
  return { name, location, offset, sessions: out };
}

function roomInfo(room) {
  // "Salt Palace | Level 2 | 250 A-C"
  const parts = room.split('|').map((p) => p.trim());
  const level = parts.map((p) => p.match(/^Level (\d+)/i)).find(Boolean);
  const name = parts[parts.length - 1];
  return { floor: level ? Number(level[1]) : 1, name, building: parts[0] };
}

// Stand-in capacity from the room name: halls and ballrooms are big, numbered rooms are workshop-sized.
function standInCapacity(name) {
  if (/hall|ballroom/i.test(name)) return 1000;
  if (/[A-Z]-[A-Z]|[A-Z]{2,}\b|&/.test(name.replace(/^\d+\s*/, ''))) return 300; // combined rooms like "250 A-C"
  return 150;
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'rightroom-schedule-import' } });
    if (res.ok) return res.text();
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`GET ${url} failed`);
}

function description(md) {
  const m = md.match(/## Description\s*\n([\s\S]*?)(\n## |\s*$)/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

async function main() {
  const index = parseIndex((await get(BASE)).replace(/\r\n?/g, '\n'));
  const talks = index.sessions.filter((s) => s.speakers.length && !SKIP_TITLE.test(s.title) && s.start && s.end);
  console.log(`${index.name}: ${index.sessions.length} sessions in the feed, ${talks.length} talks kept`);

  let done = 0;
  const queue = [...talks];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try { t.abstract = description((await get(`${BASE}/session/${t.id}`)).replace(/\r\n?/g, '\n')); } catch { t.abstract = ''; }
      if (++done % 50 === 0) console.log(`  fetched ${done}/${talks.length}`);
    }
  }));

  const rooms = new Map();
  for (const t of talks) {
    if (!rooms.has(t.room)) {
      const info = roomInfo(t.room);
      rooms.set(t.room, { id: `r-${slug(`${info.floor}-${info.name}`)}`, name: info.name, building: info.building, floor: info.floor, full: t.room });
    }
  }
  // Order rooms along each floor so the walking-time estimate has an x position.
  const byFloor = {};
  for (const r of rooms.values()) (byFloor[r.floor] ||= []).push(r);
  const roomList = [];
  for (const list of Object.values(byFloor)) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    list.forEach((r, i) => roomList.push({
      id: r.id, name: r.name, building: r.building, floor: r.floor, x: i, capacity: standInCapacity(r.name), taken: 0,
      access_seats: Math.max(2, Math.round(standInCapacity(r.name) * 0.02)), step_free: true, captions: /keynote|hall/i.test(r.name),
      overflow_space_id: null, source_room: r.full,
    }));
  }
  const biggest = [...roomList].sort((a, b) => b.capacity - a.capacity)[0];
  for (const r of roomList) r.overflow_space_id = r.id === biggest.id ? null : biggest.id;

  const tag = (t) => Object.entries(TAGS).filter(([, re]) => re.test(`${t.title} ${t.abstract}`)).map(([k]) => k);
  const out = {
    _note: `Imported from ${BASE} (real titles, descriptions, speakers, times and rooms). Stand-in: room capacities, accessibility seats, captions and walking times. Counts start at 0 and come from real scans.`,
    event: { id: 'kccnc-na-2026', name: index.name, location: index.location, timezone_offset: index.offset },
    labels: { spaces: 'stand_in', sessions: 'real' },
    venue: { id: 'venue', name: `${index.location || 'Venue'} entrance`, capacity: 10000, taken: 0, rule: 'Admitted with a registered badge.', policy: {} },
    rooms: roomList,
    rule_room: 'Seats go first come, first served at the door. Accessibility seats only go to people who stated that need.',
    sessions: talks.map((t) => ({
      id: `ks-${t.id}`, room: rooms.get(t.room).id, title: t.title, abstract: t.abstract, speakers: t.speakers,
      start: t.start, end: t.end, tags: tag(t), track: null, level: null, source_url: `${BASE}/session/${t.id}`,
    })),
    queues: [],
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Wrote ${OUT}: ${roomList.length} rooms on floors ${Object.keys(byFloor).join(', ')}, ${out.sessions.length} talks, ${out.sessions.filter((s) => s.abstract).length} with descriptions`);
}

main().catch((e) => { console.error('Import failed:', e.message); process.exit(1); });

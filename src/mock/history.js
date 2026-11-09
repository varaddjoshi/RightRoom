// Stand-in history of past talks, used by src/forecast.js. Deterministic: same data on every load.

// Small seeded PRNG (mulberry32) so the "random" spread never changes between runs.
function prng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = [
  { name: 'eBPF', tags: ['ebpf', 'observability'], pull: 1.16 },
  { name: 'Tracing', tags: ['observability', 'kubernetes'], pull: 1.06 },
  { name: 'Kubernetes operators', tags: ['kubernetes', 'platform'], pull: 0.92 },
  { name: 'Supply chain', tags: ['security', 'kubernetes'], pull: 1.3 },
  { name: 'Rust', tags: ['rust', 'ebpf'], pull: 0.86 },
  { name: 'Helm', tags: ['helm', 'kubernetes'], pull: 0.7 },
  { name: 'Platform teams', tags: ['platform'], pull: 0.78 },
  { name: 'Lightning talks', tags: ['kubernetes', 'observability', 'platform'], pull: 0.84 },
];
const SUFFIX = ['in production', 'at scale', 'from zero', 'deep dive', 'lessons learned'];
const CAPS = [40, 50, 60];

const rand = prng(20261109);
const HISTORY = Array.from({ length: 40 }, (_, i) => {
  const topic = TOPICS[i % TOPICS.length];
  const capacity = CAPS[i % CAPS.length];
  const slot = i % 2 ? 'afternoon' : 'morning';
  const keynoteAdjacent = i % 5 === 0;
  // demand as a share of capacity; over 1 means the room filled
  const demand = topic.pull * (slot === 'morning' ? 1 : 0.9) * (keynoteAdjacent ? 1.12 : 1) * (40 / capacity) ** 0.25 + (rand() - 0.5) * 0.3;
  const attendance = Math.max(5, Math.min(capacity, Math.round(capacity * demand)));
  const full = demand >= 1;
  return {
    id: `past-${i + 1}`,
    title: `${topic.name} ${SUFFIX[i % SUFFIX.length]}`,
    tags: topic.tags,
    capacity,
    attendance,
    fullMinute: full ? Math.max(1, Math.round(18 - (demand - 1) * 60)) : null, // fuller demand fills sooner
    slot,
    keynoteAdjacent,
    source: 'stand-in',
  };
});

module.exports = { HISTORY, prng };

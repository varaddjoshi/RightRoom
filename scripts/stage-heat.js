#!/usr/bin/env node
// Stages stand-in zone check-ins and Wi-Fi readings so every room has a believable heatmap:
// fronts fuller than backs, full rooms packed, weak Wi-Fi at the back of the busiest rooms.
//
//   node scripts/stage-heat.js [BASE_URL]          through the API (works anywhere; staff login from DEMO_PASSWORD)
//   node scripts/stage-heat.js [BASE_URL] --es     Wi-Fi readings bulk-indexed straight into Elasticsearch
//   node scripts/stage-heat.js [BASE_URL] --es --reset   delete earlier stand-in readings in Elasticsearch first
//   any BASE_URL other than localhost also needs --live, so nobody stages fake data on the public demo by accident
//
// Rooms always come from BASE_URL's /api/floors, so it works with the demo rooms locally and the real rooms on the
// cluster. Zone check-ins are heatmap-only stand-ins: they colour the heatmap but never take seats. --es only
// changes Wi-Fi.
// Over the API there is no delete: POST /api/sim/reset (organiser) or scripts/demo.sh starts fresh.
require('dotenv').config({ quiet: true });

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://localhost:3000').replace(/\/$/, '');
const USE_ES = args.includes('--es'), RESET = args.includes('--reset'), LIVE = args.includes('--live');
const isLocal = (u) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(u).hostname);
const PASSWORD = process.env.DEMO_PASSWORD || 'rightroom-demo';
const ZONES = ['front-left', 'front-centre', 'front-right', 'middle-left', 'middle-centre', 'middle-right', 'back-left', 'back-centre', 'back-right'];

let seed = 7; // deterministic, so reruns look the same
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function call(cookie, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

// Where people sit: fronts fill first, backs last.
const ROW = { front: 1.4, middle: 1.0, back: 0.6 };
const weight = (z) => ROW[z.split('-')[0]];

function readingsFor(room, busiest) {
  const out = [];
  const base = 18 + rand() * 40; // typical Mbps for this room
  const n = 6 + Math.floor(rand() * 7); // 6 to 12 readings
  for (let i = 0; i < n; i++) {
    const zone = ZONES[Math.floor(rand() * ZONES.length)];
    const weak = busiest && zone.startsWith('back');
    const mbps = Math.max(1, Math.round(weak ? 2 + rand() * 5 : base * (0.7 + rand() * 0.6)));
    out.push({ space: room.id, zone, floor: room.floor, mbps, ms: Math.round(weak ? 150 + rand() * 120 : 20 + rand() * 50) });
  }
  return out;
}

async function main() {
  if (!isLocal(BASE) && !LIVE) throw new Error(`${BASE} is not local. Add --live to stage stand-in heatmap data there on purpose.`);
  const login = await call(null, 'POST', '/api/login', { handle: 'dana', password: PASSWORD });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const floors = await (await call(cookie, 'GET', '/api/floors')).json();
  const rooms = floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.floor })));
  const busiest = new Set([...rooms].sort((a, b) => b.taken / b.capacity - a.taken / a.capacity).slice(0, 2).map((r) => r.id));

  // Crowd: top up each room's free seats mostly into the front; full rooms stay as they are (already packed).
  for (const r of rooms) {
    const add = Math.floor(r.free * 0.6);
    if (add < 1) continue;
    const total = ZONES.reduce((s, z) => s + weight(z), 0);
    for (const zone of ZONES) {
      const n = Math.round((add * weight(zone)) / total);
      if (n > 0) await call(cookie, 'POST', '/api/sim/zone-checkins', { space: r.id, zone, n });
    }
  }

  // Wi-Fi readings.
  const readings = rooms.flatMap((r) => readingsFor(r, busiest.has(r.id)));
  if (USE_ES) {
    const { es, INDEX } = require('../src/es');
    const { toDoc } = require('../src/wifi');
    if (RESET) await es().deleteByQuery({ index: INDEX.wifi_readings, query: { term: { label: 'stand_in' } }, refresh: true, conflicts: 'proceed' });
    const ops = readings.flatMap((r) => [{ index: { _index: INDEX.wifi_readings } }, toDoc({ ...r, at: Date.now(), standIn: true })]);
    const res = await es().bulk({ operations: ops, refresh: true });
    if (res.errors) throw new Error('Some Wi-Fi readings failed to index.');
  } else {
    for (const r of readings) await call(cookie, 'POST', '/api/sim/wifi', r);
  }

  for (const r of rooms) {
    const h = await (await call(cookie, 'GET', `/api/heat?room=${encodeURIComponent(r.id)}`)).json();
    const crowd = h.zones.map((z) => z.crowd.band[0].toUpperCase()).join('');
    const wifiN = h.zones.filter((z) => z.wifi).length;
    console.log(`${String(r.id).padEnd(14)} crowd ${crowd} (Q quiet, B busy, P packed)  wifi zones ${wifiN}/9  source ${h.source}`);
  }
  console.log(`Staged ${readings.length} Wi-Fi readings (${USE_ES ? 'Elasticsearch' : 'API'}) for ${rooms.length} rooms.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

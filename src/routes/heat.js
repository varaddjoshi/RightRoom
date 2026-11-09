// GET /api/heat?room=<id>: per-zone crowd and Wi-Fi for one room (public, no handles).
// POST /api/sim/zone-checkins and /api/sim/wifi: staff-only staging for scripts/stage-heat.js, labelled stand-in.
const express = require('express');
const { ZONES } = require('../mock/seed');
const { heat, standIns, memoryCrowd } = require('../heat');
const wifi = require('../wifi');

function heatRouter({ store, requireRole }) {
  const r = express.Router();
  const room = (id, res) => {
    const sp = store.db.spaces.get(String(id ?? ''));
    if (!sp || sp.type !== 'room' || sp.test) { res.status(404).json({ error: 'No such room.' }); return null; }
    return sp;
  };
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

  r.get('/heat', (req, res) => {
    const sp = room(req.query.room, res);
    if (sp) res.json(heat(store.db, sp));
  });

  r.post('/sim/zone-checkins', requireRole('staff'), (req, res) => {
    const sp = room(req.body?.space, res);
    if (!sp) return;
    const zone = req.body?.zone, n = num(req.body?.n ?? 5, 1, 300);
    if (!ZONES.includes(zone) || n == null) return res.status(400).json({ error: 'Give a known zone and n between 1 and 300.' });
    // Heatmap only: kept out of db.checkins so the engine never counts these as taken seats.
    const all = standIns(store.db);
    const m = all.get(sp.id) || new Map();
    all.set(sp.id, m);
    const space = Math.max(0, Math.ceil(sp.capacity / ZONES.length) - memoryCrowd(store.db, sp.id)[zone].count); // cap at the zone's seats
    const add = Math.min(n, space);
    for (let i = 0; i < add; i++) m.set(`stand-in-zone-${++store.db.seq}`, { zone, at: Date.now(), standIn: true });
    res.json({ added: add, heat: heat(store.db, sp) });
  });

  r.post('/sim/wifi', requireRole('staff'), (req, res) => {
    const sp = room(req.body?.space, res);
    if (!sp) return;
    const zone = req.body?.zone, mbps = num(req.body?.mbps, 0, 10_000), ms = num(req.body?.ms, 0, 60_000);
    if (!ZONES.includes(zone) || mbps == null || ms == null) return res.status(400).json({ error: 'Give a known zone, mbps and ms.' });
    res.json(wifi.record(store.db, { space: sp.id, zone, floor: sp.floor, mbps: Math.round(mbps), ms: Math.round(ms), at: Date.now(), standIn: true, source: 'stand-in' }));
  });

  return r;
}

module.exports = { heatRouter };

// Insight endpoints over stand-in data. Mount under /api once Phase 1's server.js lands:
//   app.use('/api', require('./src/routes/insights').makeRouter({ requireRole }))
const express = require('express');
const { HISTORY } = require('../mock/history');
const seed = require('../mock/insights-seed');
const { predictFill, backtest } = require('../forecast');
const { wifiMedians, interestCounts, metrics, topicsFor } = require('../insights');

const S = 'stand-in';
const allow = () => (req, res, next) => next();

function makeRouter({ requireRole = allow } = {}) {
  const r = express.Router();
  r.use(express.json());
  // per-router copies so POSTs never change the seed module
  const wifi = [...seed.WIFI];
  const comments = [...seed.COMMENTS];
  const rooms = new Set(seed.SESSIONS.map(s => s.room));
  const bt = backtest(HISTORY); // deterministic, so compute once

  const bad = (res, msg) => res.status(400).json({ error: msg });

  r.get('/forecast', (req, res) => res.json({
    source: S,
    sessions: seed.SESSIONS.map(s => ({ room: s.room, title: s.title, capacity: s.capacity, ...predictFill(s, HISTORY) })),
  }));
  r.get('/forecast/backtest', (req, res) => res.json(bt));

  r.get('/wifi', (req, res) => res.json({ source: S, rooms: wifiMedians(wifi) }));
  r.post('/wifi', (req, res) => {
    const { room, zone, mbps, ms } = req.body || {};
    if (!rooms.has(String(room))) return bad(res, 'Unknown room.');
    if (!seed.ZONES.includes(zone)) return bad(res, 'Zone must be one of: ' + seed.ZONES.join(', ') + '.');
    if (!Number.isFinite(mbps) || mbps < 0 || mbps > 10000) return bad(res, 'mbps must be a number from 0 to 10000.');
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) return bad(res, 'ms must be a number from 0 to 60000.');
    const reading = { room: String(room), floor: seed.SESSIONS.find(s => s.room === String(room)).floor, zone, mbps, ms, at: new Date().toISOString(), source: 'live' };
    wifi.push(reading);
    res.status(201).json({ source: 'live', reading, room: wifiMedians(wifi)[reading.room] });
  });

  r.get('/sessions/:room/topics', (req, res) => {
    const t = topicsFor(req.params.room, comments, seed.SESSIONS);
    if (!t) return res.status(404).json({ error: 'Unknown room or session.' });
    res.json({ source: S, ...t });
  });
  r.post('/comments', (req, res) => {
    const { room } = req.body || {};
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!rooms.has(String(room))) return bad(res, 'Unknown room.');
    if (!text || text.length > 280) return bad(res, 'Comment must be 1 to 280 characters.');
    comments.push({ room: String(room), text, source: 'live' }); // no handle kept (decision 12)
    res.status(201).json({ source: 'live', ok: true });
  });

  r.get('/insights/interests', requireRole('organiser'), (req, res) =>
    res.json({ source: S, ...interestCounts(seed.USERS, seed.TAG_LABELS) }));
  r.get('/metrics', (req, res) => res.json({ source: S, ...metrics(seed.LOG) }));
  r.get('/tables', (req, res) => res.json({ source: S, tables: seed.TABLES }));
  r.get('/alerts', (req, res) => res.json({ source: S, alerts: seed.ALERTS }));
  r.get('/team-finder', (req, res) => res.json({ source: S, people: seed.SOLO }));
  return r;
}

module.exports = { makeRouter };

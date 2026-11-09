// Read-only insight endpoints. Writes (Wi-Fi readings, comments) go through Phase 1's
// POST /api/spaces/:id/wifi and /api/spaces/:id/comments into db().wifi and db().comments.
// Mount after Phase 1:
//   require('./src/mock/insights-seed').seedInto(store.db)
//   app.use('/api', require('./src/routes/insights').makeRouter({ requireRole: auth.requireRole, db: () => store.db }))
const express = require('express');
const { HISTORY } = require('../mock/history');
const seed = require('../mock/insights-seed');
const { predictFill, backtest } = require('../forecast');
const { wifiMedians, interestCounts, metrics, topicsFor } = require('../insights');

const S = 'stand-in';
const allow = () => (req, res, next) => next();

function makeRouter({ requireRole = allow, db } = {}) {
  // Without a Phase 1 store, serve a private copy of the stand-in readings and comments.
  if (!db) { const own = seed.seedInto({ wifi: [], comments: [], seq: 0 }); db = () => own; }
  const r = express.Router();
  const bt = backtest(HISTORY); // deterministic, so compute once

  r.get('/forecast', (req, res) => res.json({
    source: S,
    sessions: seed.SESSIONS.map(s => ({ room: s.room, title: s.title, capacity: s.capacity, ...predictFill(s, HISTORY) })),
  }));
  r.get('/forecast/backtest', (req, res) => res.json(bt));
  // Medians mix stand-in and live readings; label them by what they contain.
  r.get('/wifi', (req, res) => {
    const w = db().wifi;
    res.json({ source: w.every(x => x.standIn) ? S : 'mixed', rooms: wifiMedians(w) });
  });
  r.get('/sessions/:room/topics', (req, res) => {
    const t = topicsFor(req.params.room, db().comments, seed.SESSIONS);
    if (!t) return res.status(404).json({ error: 'Unknown room or session.' });
    res.json({ source: db().comments.every(c => c.standIn) ? S : 'mixed', ...t });
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

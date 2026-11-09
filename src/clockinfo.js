// Tells screens whether the app runs on a demo clock (DEMO_CLOCK, src/clock.js) and what time it thinks it is, so
// public/demo-clock.js can label stand-in time as such. Nothing here is secret or personal.
const express = require('express');
const clock = require('./clock');

function router() {
  const r = express.Router();
  r.get('/api/clock', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ demo: clock.demoClock(), now: clock.now().toISOString() });
  });
  return r;
}

module.exports = { router };

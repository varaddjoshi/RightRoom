// GET /api/search: validates the query (trust boundary), then src/search.js does the work.
const express = require('express');
const { search } = require('../search');

const STATUSES = ['free', 'filling', 'full'];

function parse(query) {
  const one = (k) => {
    const v = query[k];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') throw new Error(`${k} must be given once.`);
    return v;
  };
  const flag = (k) => {
    const v = one(k);
    if (v === undefined || v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
    throw new Error(`${k} must be 1 or 0.`);
  };
  const q = (one('q') || '').trim();
  if (q.length > 100) throw new Error('q must be 100 characters or fewer.');
  const f = one('floor');
  const floor = f === undefined || f === '' ? null : Number(f);
  if (floor !== null && !(Number.isInteger(floor) && floor >= 1 && floor <= 20)) throw new Error('floor must be a whole number from 1 to 20.');
  const status = one('status') || null;
  if (status && !STATUSES.includes(status)) throw new Error(`status must be one of: ${STATUSES.join(', ')}.`);
  const l = one('limit');
  const limit = l === undefined || l === '' ? 10 : Number(l);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 20)) throw new Error('limit must be a whole number from 1 to 20.');
  return { q, floor, stepFree: flag('stepFree'), free: flag('free'), soon: flag('soon'), mine: flag('mine'), status, limit };
}

function searchRouter({ engine }) {
  const r = express.Router();
  r.get('/search', async (req, res) => {
    let p;
    try { p = parse(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (p.mine && !req.user) return res.status(401).json({ error: 'Sign in to search your interests.' });
    try { res.json(await search(engine, req.user, p)); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong.' }); }
  });
  return r;
}

module.exports = { searchRouter, parse };

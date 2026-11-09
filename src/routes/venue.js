// Organiser venue setup and host talk editing (P2). Thin handlers; the rules are in src/catalog.js.
//
// Organiser (S1):  GET/PUT /api/staff/venue, POST /api/staff/venue/rooms, PUT/DELETE /api/staff/venue/rooms/:id,
//                  GET/POST /api/staff/sessions, PUT/DELETE /api/staff/sessions/:id, PUT /api/staff/sessions/:id/hosts
// Host (/host):    GET /api/host/sessions, GET/PUT /api/host/sessions/:id (only talks they host; details only)
// Anyone:          GET /api/talks/:id (a talk's details, without who hosts it)
const express = require('express');
const auth = require('../auth');
const catalog = require('../catalog');

function venueRouter({ store, engine }) {
  const r = express.Router();
  const db = () => store.db;
  const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
  // Async version of the api.js handler wrapper: thrown {status, message} becomes JSON, anything else a plain 500.
  const a = (fn) => async (req, res) => {
    try { res.json(await fn(req, res)); }
    catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' });
    }
  };
  const signedIn = (req) => req.user || fail('Sign in first.', 401);
  const organiser = auth.requireRole('organiser');

  // Organiser: the venue, its layout (buildings > floors > rooms) and each room's capacity and access.
  r.get('/staff/venue', organiser, a(() => catalog.venueView(db())));
  r.put('/staff/venue', organiser, a((req) => catalog.updateVenue(db(), req.body || {}, engine)));
  r.post('/staff/venue/rooms', organiser, a((req) => catalog.createRoom(db(), req.body || {}, engine)));
  r.put('/staff/venue/rooms/:id', organiser, a((req) => catalog.updateRoom(db(), req.params.id, req.body || {}, engine)));
  r.delete('/staff/venue/rooms/:id', organiser, a((req) => catalog.deleteRoom(db(), req.params.id)));

  // Organiser: talks, when and where they run, and who hosts them.
  r.get('/staff/sessions', organiser, a((req) => catalog.listTalks(db(), { room: req.query.room, host: req.query.host, limit: 1000 })));
  r.post('/staff/sessions', organiser, a((req) => catalog.createTalk(db(), req.body || {})));
  r.put('/staff/sessions/:id', organiser, a((req) => catalog.updateTalk(db(), req.params.id, req.body || {}, req.user)));
  r.delete('/staff/sessions/:id', organiser, a((req) => catalog.deleteTalk(db(), req.params.id)));
  r.put('/staff/sessions/:id/hosts', organiser, a((req) => catalog.setHosts(db(), req.params.id, req.body?.hosts)));

  // Hosts: the talks they host, and their details (title, abstract, speakers, tags, track, level).
  r.get('/host/sessions', a((req) => catalog.listTalks(db(), { host: signedIn(req).handle })));
  r.get('/host/sessions/:id', a((req) => {
    const u = signedIn(req);
    const s = catalog.getTalk(db(), req.params.id);
    if (u.role !== 'organiser' && !(s.host_handles || []).includes(u.handle)) fail("You're not a host of this talk.", 403);
    return catalog.talkView(s);
  }));
  r.put('/host/sessions/:id', a((req) => catalog.updateTalk(db(), req.params.id, req.body || {}, signedIn(req))));

  // Anyone signed in: change your own password, giving the current one. {current, password}
  r.put('/me/password', a((req) => {
    auth.changePassword(db(), signedIn(req).handle, req.body?.current, req.body?.password);
    return { changed: true };
  }));

  // Anyone: one talk's public details. Who hosts it stays private.
  r.get('/talks/:id', a((req) => {
    const { hosts, ...talk } = catalog.talkView(catalog.getTalk(db(), req.params.id));
    return talk;
  }));

  return r;
}

module.exports = { venueRouter };

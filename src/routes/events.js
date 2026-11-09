// Event listings (/events, /e/:slug): details, agenda, RSVP and a calendar file. Data: src/mock/events.js.
// The live event's capacity and registrations come from the engine's venue, so they match /event (A3).
const express = require('express');
const clock = require('../clock');
const { EVENTS, bySlug } = require('../mock/events');

// Two events overlap when one starts before the other ends.
const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

// My next session in one event: on now or later, ones matching my interests first, then the earliest.
// shortcut: interests stand in for starred talks (no stars stored yet); swap in stars when A2 stores them.
function nextFor(e, user, now) {
  const ahead = e.sessions.filter((s) => Date.parse(s.end) > now);
  const mineFirst = ahead.filter((s) => s.tags.some((t) => (user.interests || []).includes(t)));
  const s = mineFirst[0] || ahead[0];
  return s ? { ...s, forYou: mineFirst[0] === s, now: Date.parse(s.start) <= now } : null;
}

function eventsRouter({ store, engine }) {
  const r = express.Router();
  const rsvps = (slug) => { const all = (store.db.rsvps ||= {}); return (all[slug] ||= []); }; // ||=: older saved states have no rsvps
  const ev = (req, res) => {
    const e = /^[a-z0-9-]{1,60}$/.test(req.params.slug) ? bySlug(req.params.slug) : null;
    if (!e) res.status(404).json({ error: 'No such event.' });
    return e;
  };
  const status = (e, now) => (now < Date.parse(e.start) ? 'upcoming' : now < Date.parse(e.end) ? 'live' : 'past');

  // Numbers and the signed-in person's place: from the engine for the live event, from RSVPs for the others.
  function numbers(e, user) {
    if (e.eventId) {
      const v = engine.view(engine.space('venue'));
      return { capacity: v.capacity, going: v.taken, rule: v.rule, register: true, me: user ? engine.myVenue(user.handle) : null };
    }
    const list = rsvps(e.slug);
    const i = user ? list.indexOf(user.handle) : -1;
    const me = i < 0 ? null : i < e.capacity ? { status: 'going' } : { status: 'waitlist', position: i - e.capacity + 1 };
    return { capacity: e.capacity, going: Math.min(list.length, e.capacity), waitlist: Math.max(0, list.length - e.capacity), rule: e.rule, register: false, me };
  }
  // Events this person joined: a live venue place that isn't expired, or an RSVP (going or waitlisted).
  const mine = (user) => (user ? EVENTS.filter((e) => (e.eventId ? ['admitted', 'waiting'].includes(engine.myVenue(user.handle)?.status) : rsvps(e.slug).includes(user.handle))) : []);
  const canJoin = (req, res, what) => {
    if (!req.user) { res.status(401).json({ error: 'Sign in first.' }); return false; }
    if (req.user.role === 'guest') { res.status(403).json({ error: `Create an account to ${what}.` }); return false; }
    return true;
  };
  const card = (e, now, user) => {
    const { sessions, speakers, description, faq, accessibility, hosts, codeOfConduct, rooms, ...rest } = e;
    const n = numbers(e, user);
    return { ...rest, status: status(e, now), sessionCount: sessions.length, capacity: n.capacity, going: n.going };
  };

  r.get('/events', (req, res) => {
    const now = clock.nowMs();
    res.json(EVENTS.map((e) => card(e, now, req.user)).sort((a, b) => a.start.localeCompare(b.start)));
  });
  // My events: each event I registered or RSVP'd for, with its own status and my next session in it. Never merged
  // across events: every next session belongs to, and is labelled with, its event (name, city, timezone).
  r.get('/events/mine', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    const now = clock.nowMs();
    res.json(mine(req.user).map((e) => ({ ...card(e, now, req.user), me: numbers(e, req.user).me, daysUntil: Math.max(0, Math.ceil((Date.parse(e.start) - now) / 86_400_000)), next: nextFor(e, req.user, now) })));
  });
  r.get('/events/:slug', (req, res) => {
    const e = ev(req, res);
    if (!e) return;
    const now = clock.nowMs();
    const { rooms, ...rest } = e;
    res.json({ ...rest, ...numbers(e, req.user), status: status(e, now), now: new Date(now).toISOString() });
  });

  // RSVP, or Register for the live event (same engine flow as POST /api/event/register). Joining an event whose dates
  // overlap one you already joined answers 409 with `overlap` unless the body says {force: true}, so the page can warn.
  r.post('/events/:slug/rsvp', (req, res) => {
    const e = ev(req, res);
    if (!e || !canJoin(req, res, 'RSVP')) return;
    const clash = mine(req.user).find((x) => x.slug !== e.slug && overlaps(x, e));
    if (clash && req.body?.force !== true) {
      return res.status(409).json({ error: `This overlaps ${clash.name} in ${clash.city}, which you already joined. You can't be in both places.`, overlap: { slug: clash.slug, name: clash.name, city: clash.city } });
    }
    if (e.eventId) engine.register(req.user);
    else if (!rsvps(e.slug).includes(req.user.handle)) rsvps(e.slug).push(req.user.handle);
    res.json(numbers(e, req.user));
  });
  r.delete('/events/:slug/rsvp', (req, res) => {
    const e = ev(req, res);
    if (!e || !canJoin(req, res, 'RSVP')) return;
    if (e.eventId) return res.status(409).json({ error: 'Leave the live event from its venue page.' });
    const list = rsvps(e.slug);
    const i = list.indexOf(req.user.handle);
    if (i >= 0) list.splice(i, 1);
    res.json(numbers(e, req.user));
  });

  // Add to calendar: one VEVENT for the whole event.
  // shortcut: no line folding at 75 octets; calendar apps accept our short lines, add folding if a client rejects it.
  r.get('/events/:slug/calendar.ics', (req, res) => {
    const e = ev(req, res);
    if (!e) return;
    const t = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const txt = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const url = `${req.protocol}://${req.get('host')}/e/${e.slug}`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RightRoom//Events//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${e.slug}@rightroom`, `DTSTAMP:${t(new Date().toISOString())}`, `DTSTART:${t(e.start)}`, `DTEND:${t(e.end)}`,
      `SUMMARY:${txt(e.name)}`, `DESCRIPTION:${txt(`${e.tagline}\n${url}`)}`, `LOCATION:${txt(`${e.venue.name}, ${e.venue.address}`)}`, `URL:${url}`,
      'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${e.slug}.ics"`).send(ics);
  });

  return r;
}

module.exports = { eventsRouter, overlaps, nextFor };

// Server-sent events. Each event carries the server time so /api/ack can measure delivery on the server's own clock (SLO 1).
// shortcut: subscribers live in this process only; run exactly one replica.
const { recordDelivery } = require('./metrics');
const HEARTBEAT_MS = 10_000;
const subs = new Set();
const sent = new Map(); // event id -> { at: server time, type }, for /api/ack
let nextId = 0;

function subscribe(req, res, { space, handle }) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  const s = { res, space, handle };
  subs.add(s);
  // The hackathon gateway in front of https://pantheon.cnh.radarhq.io closes a connection that is quiet for 15 seconds
  // (measured), so ping well inside that; at 20 seconds every phone reconnected every 15 and could miss events.
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => { clearInterval(beat); subs.delete(s); });
}

// `to.space`: everyone watching that space (or '*'); `to.handle`: one person, on any page.
function publish(type, data, to = {}) {
  const ev = { ...data, event_id: ++nextId, at: Date.now() };
  sent.set(ev.event_id, { at: ev.at, type, ackedBy: new Set() });
  if (sent.size > 5000) sent.delete(sent.keys().next().value);
  const line = `id: ${ev.event_id}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const s of subs) {
    const forSpace = to.space && (s.space === '*' || s.space === to.space);
    const forHandle = to.handle && s.handle === to.handle;
    if (forSpace || forHandle || (!to.space && !to.handle)) s.res.write(line);
  }
  return ev;
}

const deliveries = [];
// `who` is the signed-in handle that saw the event (route passes req.user?.handle). SLO 1 counts each event once
// per handle: /api/ack is open to anyone and event ids are sequential, so without this a repeat or forged ack
// could push the SLO ratio anywhere. A repeat still gets its answer, but is not counted again. An ack with no
// handle (a signed-out page, such as the big screen) is also answered but never reaches the SLO, since it
// cannot be told apart from a repeat. SLO 1 is about phones, where people are signed in or guests.
function ack(eventId, now = Date.now(), who) {
  const e = sent.get(Number(eventId));
  if (!e) return null;
  const ms = now - e.at;
  if (who) {
    if (e.ackedBy.has(who)) return ms;
    e.ackedBy.add(who);
  }
  deliveries.push(ms);
  if (deliveries.length > 500) deliveries.shift();
  if (who) recordDelivery(e.type, ms);
  console.log(`slo1 event=${eventId} delivery_ms=${ms}`);
  return ms;
}

module.exports = { subscribe, publish, ack, deliveries, HEARTBEAT_MS };

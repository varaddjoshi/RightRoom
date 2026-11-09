// Server-sent events. Each event carries the server time so /api/ack can measure delivery on the server's own clock (SLO 1).
// shortcut: subscribers live in this process only; run exactly one replica.
const subs = new Set();
const sent = new Map(); // event id -> server time, for /api/ack
let nextId = 0;

function subscribe(req, res, { space, handle }) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  const s = { res, space, handle };
  subs.add(s);
  const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(beat); subs.delete(s); });
}

// `to.space`: everyone watching that space (or '*'); `to.handle`: one person, on any page.
function publish(type, data, to = {}) {
  const ev = { ...data, event_id: ++nextId, at: Date.now() };
  sent.set(ev.event_id, ev.at);
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
function ack(eventId, now = Date.now()) {
  const at = sent.get(Number(eventId));
  if (!at) return null;
  const ms = now - at;
  deliveries.push(ms);
  if (deliveries.length > 500) deliveries.shift();
  console.log(`slo1 event=${eventId} delivery_ms=${ms}`);
  return ms;
}

module.exports = { subscribe, publish, ack, deliveries };

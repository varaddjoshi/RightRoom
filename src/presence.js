// Proof of presence for check-in: the "I'm in the room" QR carries a key signed for that room and day,
// so you can only count yourself in by scanning the code inside the room (Hitesh's decision).
// shortcut: one key per room per day, so a photo of the code works for that whole day; rotate per session if abused.
// The day is the REAL day (Date.now), never the demo clock (DEMO_CLOCK): a demo clock restarts at the same moment on every
// restart, so a key built from it would never rotate and printed sheets could expire while the pod runs.
const crypto = require('node:crypto');
const auth = require('./auth');

const DAY_MS = 86_400_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// PRESENCE_SECRET lets printed codes outlive a SESSION_SECRET change; otherwise reuse the session secret.
const mac = (text) => (process.env.PRESENCE_SECRET
  ? crypto.createHmac('sha256', process.env.PRESENCE_SECRET).update(text).digest('base64url')
  : auth.hmac(text));

function roomKey(roomId, ms = Date.now()) {
  return mac(`presence.${roomId}.${day(ms)}`).slice(0, 10);
}

// Today's or yesterday's key, so a code printed before midnight still works after it.
function verify(roomId, k, ms = Date.now()) {
  if (typeof k !== 'string' || k.length !== 10) return false;
  return [ms, ms - DAY_MS].some((t) => crypto.timingSafeEqual(Buffer.from(roomKey(roomId, t)), Buffer.from(k)));
}

module.exports = { roomKey, verify };

// The app's one source of time (Varad's decision: the demo runs on a demo clock).
//
// DEMO_CLOCK=2026-11-10T11:45:00-07:00 makes now() start at that moment when the process starts and tick
// forward in real time from there, so a Monday demo behaves like Tuesday 11:45 at KubeCon (21 real talks on).
// Unset, now() is the real time. Screens should show a "Demo clock" label when demoClock() is true.

const BOOT = Date.now();
const DEMO_START = process.env.DEMO_CLOCK ? Date.parse(process.env.DEMO_CLOCK) : NaN;
if (process.env.DEMO_CLOCK && Number.isNaN(DEMO_START)) {
  throw new Error(`DEMO_CLOCK is not a valid time: ${process.env.DEMO_CLOCK}`);
}

function nowMs() {
  return Number.isNaN(DEMO_START) ? Date.now() : DEMO_START + (Date.now() - BOOT);
}

function now() {
  return new Date(nowMs());
}

function demoClock() {
  return !Number.isNaN(DEMO_START);
}

module.exports = { now, nowMs, demoClock };

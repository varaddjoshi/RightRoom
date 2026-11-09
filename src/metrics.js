// SLO 1 as Dash0 metrics: live updates reach phones within 10 seconds.
//
// stream.ack() calls recordDelivery() each time a page confirms it showed an event. The server
// times it on its own clock (publish -> ack), so a phone's wrong clock cannot skew the number.
//
// Two instruments, because Dash0 SLOs are "good events / all events":
//   rightroom.slo1.delivery_time  histogram (ms): how long delivery took, for the percentile graphs
//   rightroom.slo1.deliveries     counter: one per ack, with slo1.within_10s = true|false
// Both carry event.type (status, position, offer, offer_passed, announcement). Announcements are
// not part of SLO 1 (it covers admission and seat updates), so filter them out in the SLO query.
//
// Without the OpenTelemetry SDK (tests, CI, `node server.js`) the API hands back a no-op meter,
// so this file is safe to load everywhere. Keep attributes low-cardinality: never add a handle
// or event id here.
const { metrics } = require('@opentelemetry/api');

const SLO1_MS = 10_000;

const meter = metrics.getMeter('rightroom');
const deliveryTime = meter.createHistogram('rightroom.slo1.delivery_time', {
  description: 'Server time from publishing a live event to a page confirming it showed it (SLO 1)',
  unit: 'ms',
  // A boundary exactly at the 10 s target, so "within SLO" is readable straight off the buckets.
  advice: { explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000] },
});
const deliveries = meter.createCounter('rightroom.slo1.deliveries', {
  description: 'Confirmed live-event deliveries, split by whether they met the 10 second target (SLO 1)',
});

const withinSlo1 = (ms) => ms <= SLO1_MS;

function recordDelivery(type, ms) {
  const delay = Math.max(0, ms);
  const attrs = { 'event.type': type || 'unknown', 'slo1.within_10s': withinSlo1(delay) };
  deliveryTime.record(delay, { 'event.type': attrs['event.type'] });
  deliveries.add(1, attrs);
}

module.exports = { recordDelivery, withinSlo1, SLO1_MS };

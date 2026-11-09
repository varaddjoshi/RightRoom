// SLO 1 metric: a confirmed delivery is recorded with its event type and whether it met 10 seconds.
// A fake meter is registered before the code loads, so this needs no OpenTelemetry SDK and no Dash0.
// (node --test runs each file in its own process, so the global meter provider is ours alone.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { metrics } = require('@opentelemetry/api');

const histograms = [];
const counters = [];
metrics.setGlobalMeterProvider({
  getMeter: () => ({
    createHistogram: (name) => ({ record: (value, attrs) => histograms.push({ name, value, attrs }) }),
    createCounter: (name) => ({ add: (value, attrs) => counters.push({ name, value, attrs }) }),
  }),
});

const stream = require('../src/stream');
const { withinSlo1 } = require('../src/metrics');

test('a delivery inside 10 s is recorded as within SLO 1, tagged with its event type', () => {
  const ev = stream.publish('offer', { offer: 'o1' }, { handle: 'ann' });
  assert.equal(stream.ack(ev.event_id, ev.at + 1200), 1200);
  assert.deepEqual(histograms.at(-1), { name: 'rightroom.slo1.delivery_time', value: 1200, attrs: { 'event.type': 'offer' } });
  assert.deepEqual(counters.at(-1), { name: 'rightroom.slo1.deliveries', value: 1, attrs: { 'event.type': 'offer', 'slo1.within_10s': true } });
});

test('a delivery over 10 s is recorded as outside SLO 1', () => {
  const ev = stream.publish('status', { space: '204' }, { space: '204' });
  stream.ack(ev.event_id, ev.at + 12_000);
  assert.equal(counters.at(-1).attrs['slo1.within_10s'], false);
  assert.equal(counters.at(-1).attrs['event.type'], 'status');
});

test('an unknown or expired event id records nothing', () => {
  const before = counters.length;
  assert.equal(stream.ack(999_999), null);
  assert.equal(counters.length, before);
});

test('the 10 s boundary counts as within SLO 1', () => {
  assert.equal(withinSlo1(10_000), true);
  assert.equal(withinSlo1(10_001), false);
});

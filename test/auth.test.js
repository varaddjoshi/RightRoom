const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STAFF = 'leo,alice';
process.env.ORGANISERS = 'dana';
const auth = require('../src/auth');

test('allowlisted staff and organiser names and demo accounts cannot be claimed by signing up', () => {
  const db = { users: new Map() };
  for (const h of ['alice', 'dana', 'leo', 'sam']) assert.throws(() => auth.signup(db, h, 'long-enough-pw'), (e) => e.status === 409);
  assert.equal(auth.signup(db, 'riya', 'long-enough-pw').role, 'attendee');
});

test('a signed session cookie round-trips and a tampered one fails', () => {
  const t = auth.sign('riya');
  assert.equal(auth.verify(t), 'riya');
  assert.equal(auth.verify(t.replace('riya', 'dana')), null);
});

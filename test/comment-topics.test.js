const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => server.close());

test('room comment topics are phrases, not filler words', async () => {
  const t305 = (await (await fetch(`${base}/api/spaces/305/comments`)).json()).topics;
  assert.ok(t305.includes('stairs only'), JSON.stringify(t305));
  assert.ok(!t305.includes('only') && !t305.includes('stairs'), JSON.stringify(t305));
  const t204 = (await (await fetch(`${base}/api/spaces/204/comments`)).json()).topics;
  assert.ok(t204.includes('slides too small'), JSON.stringify(t204));
});

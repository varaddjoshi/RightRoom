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

test('a room with a single comment still gets topics and a comment count', async () => {
  const store = require('../src/store');
  store.db.comments = store.db.comments.filter((c) => c.space !== '310');
  store.db.comments.push({ id: ++store.db.seq, space: '310', text: 'Helm chart linting demo was excellent', at: Date.now(), hidden: false });
  const body = await (await fetch(`${base}/api/spaces/310/comments`)).json();
  assert.equal(body.comments, 1);
  assert.ok(body.topics.length > 0, JSON.stringify(body));
});

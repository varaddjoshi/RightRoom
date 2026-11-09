// Organiser venue setup and host talk editing over HTTP (src/catalog.js, src/routes/venue.js), in memory.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ELASTICSEARCH_URL;
const { app } = require('../server');

async function withServer(fn) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, cookie = '') => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
  };
  const login = async (handle) => (await call('POST', '/api/login', { handle, password: 'rightroom-demo' })).cookie;
  const signup = async (handle) => (await call('POST', '/api/signup', { handle, password: 'long-enough-pw' })).cookie;
  try { await fn({ call, login, signup }); } finally { server.closeAllConnections(); server.close(); }
}

test('organiser: venue layout, add a room, change it, and it shows up live', async () => {
  await withServer(async ({ call, login }) => {
    const dana = await login('dana');
    const v = (await call('GET', '/api/staff/venue', null, dana)).data;
    assert.equal(v.rooms, 7);
    assert.ok(v.layout[0].floors.length >= 3 && v.venue.capacity > 0);

    const made = await call('POST', '/api/staff/venue/rooms', { name: 'Hall C', building: 'Annex', floor: 2, capacity: 3, access_seats: 1, step_free: true, captions: true }, dana);
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const id = made.data.id;
    assert.equal(id, 'r-2-hall-c');
    assert.ok(made.data.walks.length === 7, 'walking times to every other room are estimated');
    const floors = (await call('GET', '/api/floors')).data;
    const tile = floors.flatMap((f) => f.rooms).find((r) => r.id === id);
    assert.ok(tile && tile.building === 'Annex' && tile.access === 'Step-free · captions' && tile.capacity === 3);

    // Live: people can queue at the new room, and a capacity change flips it to Full.
    const guest = (await call('POST', '/api/guest')).cookie;
    assert.equal((await call('POST', `/api/spaces/${id}/queue`, null, guest)).status, 200);
    assert.equal((await call('PUT', `/api/staff/venue/rooms/${id}`, { capacity: 1, access_seats: 0, walks: [{ to: '310', minutes: 4 }] }, dana)).data.capacity, 1);
    assert.equal((await call('GET', `/api/spaces/${id}`)).data.status, 'full');
    assert.equal((await call('GET', `/api/spaces/310/redirect`, null, guest)).status, 200);

    // Walks go both ways: the other rooms get the reverse entry, and it follows an edit.
    const room310 = async () => (await call('GET', '/api/staff/venue', null, dana)).data.layout.flatMap((b) => b.floors).flatMap((f) => f.rooms).find((r) => r.id === '310');
    assert.equal((await room310()).walks.find((w) => w.to === id).minutes, 4);
    await call('PUT', '/api/staff/venue/rooms/310', { overflow_space_id: id }, dana);

    // Not while people are there; fine once it's empty, and other rooms forget it.
    assert.equal((await call('DELETE', `/api/staff/venue/rooms/${id}`, null, dana)).status, 409);
    await call('POST', '/api/sim/end-session', { space: id }, dana);
    assert.equal((await call('DELETE', `/api/staff/venue/rooms/${id}`, null, dana)).status, 200);
    assert.equal((await call('GET', '/api/staff/venue', null, dana)).data.rooms, 7);
    const after = await room310();
    assert.equal(after.overflow_space_id, null);
    assert.ok(!after.walks.some((w) => w.to === id));

    const venue = await call('PUT', '/api/staff/venue', { name: 'Salt Palace', capacity: 9000 }, dana);
    assert.deepEqual([venue.data.name, venue.data.capacity], ['Salt Palace', 9000]);
  });
});

test('organiser input is checked, and only organisers can change the venue', async () => {
  await withServer(async ({ call, login }) => {
    const dana = await login('dana');
    const leo = await login('leo');
    assert.equal((await call('POST', '/api/staff/venue/rooms', { name: '', capacity: 10 }, dana)).status, 400);
    assert.equal((await call('POST', '/api/staff/venue/rooms', { name: 'X', capacity: 0 }, dana)).status, 400);
    assert.equal((await call('POST', '/api/staff/venue/rooms', { name: 'X', capacity: 10, access_seats: 11 }, dana)).status, 400);
    assert.equal((await call('PUT', '/api/staff/venue/rooms/310', { walks: [{ to: 'nowhere', minutes: 2 }] }, dana)).status, 400);
    assert.equal((await call('POST', '/api/staff/venue/rooms', { name: 'X', capacity: 10 }, leo)).status, 403);
    assert.equal((await call('GET', '/api/staff/venue')).status, 401);
  });
});

test('hosts: the organiser assigns a talk, and the host edits only its details', async () => {
  await withServer(async ({ call, login, signup }) => {
    const dana = await login('dana');
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 40 * 60_000).toISOString();
    const t = await call('POST', '/api/staff/sessions', { room_id: '310', start, end, title: 'Helm at scale', hosts: ['alice'] }, dana);
    assert.equal(t.status, 200, JSON.stringify(t.data));
    const id = t.data.id;
    assert.deepEqual(t.data.hosts, ['alice']);

    const alice = await signup('alice');
    const bob = await signup('bob');
    assert.deepEqual((await call('GET', '/api/me', null, alice)).data.hosting, [id]);
    assert.deepEqual((await call('GET', '/api/host/sessions', null, alice)).data.talks.map((x) => x.id), [id]);
    assert.equal((await call('GET', '/api/host/sessions', null, bob)).data.total, 0);

    const edit = await call('PUT', `/api/host/sessions/${id}`, { title: 'Helm charts at scale', abstract: 'Library charts and OCI registries.', speakers: ['Alice A.'], tags: ['helm', 'kubernetes'], level: 'intermediate' }, alice);
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal(edit.data.title, 'Helm charts at scale');
    assert.equal((await call('PUT', `/api/host/sessions/${id}`, { room_id: '204' }, alice)).status, 403);
    assert.equal((await call('PUT', `/api/host/sessions/${id}`, { title: 'Hijack' }, bob)).status, 403);
    assert.equal((await call('PUT', `/api/host/sessions/${id}`, { tags: ['Not A Tag!'] }, alice)).status, 400);

    // The room now shows the talk that's on, and anyone can read it, but not who hosts it.
    const room = (await call('GET', '/api/spaces/310')).data;
    assert.equal(room.title, 'Helm charts at scale');
    const pub = (await call('GET', `/api/talks/${id}`)).data;
    assert.equal(pub.abstract, 'Library charts and OCI registries.');
    assert.equal(pub.hosts, undefined);

    // Organisers move talks and change hosts; then the old host loses access.
    assert.equal((await call('PUT', `/api/staff/sessions/${id}`, { end: start }, dana)).status, 400);
    assert.equal((await call('PUT', `/api/staff/sessions/${id}/hosts`, { hosts: ['bob'] }, dana)).status, 200);
    assert.equal((await call('PUT', `/api/host/sessions/${id}`, { title: 'Again' }, alice)).status, 403);
    assert.equal((await call('PUT', `/api/host/sessions/${id}`, { title: 'Helm, by Bob' }, bob)).status, 200);
    assert.equal((await call('DELETE', `/api/staff/sessions/${id}`, null, dana)).status, 200);
    assert.equal((await call('GET', `/api/talks/${id}`)).status, 404);
  });
});

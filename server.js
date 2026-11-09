const path = require('node:path');
const express = require('express');
const store = require('./src/store'); // in memory; saved to Elasticsearch when ELASTICSEARCH_URL is set
const auth = require('./src/auth');
const stream = require('./src/stream');
const { createEngine } = require('./src/engine');
const { redirect } = require('./src/mock/redirect');
const { api } = require('./src/routes/api');
const { fillStandIns } = require('./src/mock/insights-seed');

const PORT = process.env.PORT || 3000;
const engine = createEngine({ store, redirect, publish: stream.publish });
require('./src/slo2').instrument({ engine, store }); // SLO 2 and the other Dash0 proof numbers; wraps engine methods, changes nothing
auth.ensureDemoUsers(store.db);
const catalog = require('./src/catalog'); // venue, rooms and talks; organisers and hosts edit them
catalog.ensureSessions(store.db);
catalog.ensureDemoHost(store.db, 'host', { log: { log() {} } }); // the 'host' demo login hosts one room's talks
// "Reset demo" re-seeds the live state; the venue and talks come back from Elasticsearch when it's on.
const seedReset = store.reset;
store.reset = (now) => {
  const db = seedReset(now);
  auth.ensureDemoUsers(db);
  const venue = catalog.esOn() ? catalog.loadFromES(db) : Promise.resolve(catalog.ensureSessions(db));
  venue.then(() => { catalog.ensureDemoHost(db); fillStandIns(db); }).catch((e) => console.error(`[catalog] Reload after reset failed: ${e.message}`));
  return db;
};

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(auth.middleware(store));

app.get('/health', (req, res) => {
  // version is the image's commit (set by the build), so a deploy can be checked from outside.
  res.json({ status: 'ok', service: 'rightroom', version: process.env.APP_VERSION || 'dev', store: store.mode });
});
app.use(require('./src/rum').router()); // browser monitoring settings and SDK file; off without DASH0_BROWSER_TOKEN
app.use(require('./src/clockinfo').router()); // GET /api/clock: lets screens label a demo clock (public/demo-clock.js)
app.use('/api', api({ store, engine }));
app.use('/api', require('./src/routes/insights').makeRouter({ requireRole: auth.requireRole, db: () => store.db }));
app.use('/api', require('./src/routes/search').searchRouter({ engine }));
app.use('/api', require('./src/routes/events').eventsRouter({ store, engine })); // /events listings, agenda, RSVP, .ics
app.use('/api', require('./src/routes/heat').heatRouter({ engine, store, requireRole: auth.requireRole }));
app.use(require('./src/routes/qr').qrRouter({ store, requireRole: auth.requireRole }));
app.use('/api', require('./src/routes/venue').venueRouter({ store, engine }));

// Screen URLs from docs/journey-map.md, each served by one page in public/.
const PAGES = {
  '/login': 'login', '/me': 'me', '/event': 'event', '/sessions': 'sessions', '/news': 'news',
  '/r/:room': 'room', '/r/:room/in': 'in',
  '/host': 'host', '/staff/venue': 'venue', '/staff/room/:room': 'staff-room', '/staff/setup': 'staff-setup', '/staff/qr': 'staff-qr', '/screen/:room': 'screen', '/sim': 'sim', '/scan': 'scan',
  '/events': 'events', '/e/:slug': 'e',
};
for (const [url, page] of Object.entries(PAGES)) {
  app.get(url, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`), (e) => e && res.status(404).send('Page not built yet.')));
}
app.get('/', (req, res) => res.redirect('/event'));
app.use(express.static(path.join(__dirname, 'public')));

async function main() {
  // Saved state first (src/store.js), so nothing is served from the seed and then overwritten.
  await store.restore();
  auth.setSecret(store.sessionSecret);
  auth.ensureDemoUsers(store.db);
  // The real venue and talks (P1's rr_spaces / rr_sessions) replace the stand-in rooms when Elasticsearch is on.
  if (store.mode === 'elasticsearch') {
    try { await catalog.loadFromES(store.db); } catch (e) { console.error(`[catalog] Could not load the venue from Elasticsearch (${e.message}); keeping the rooms from the saved state.`); }
  }
  catalog.ensureSessions(store.db);
  await catalog.ensureDemoHost(store.db).catch((e) => console.error(`[catalog] Demo host: ${e.message}`));
  fillStandIns(store.db); // stand-in Wi-Fi, heat, comments and attendees for rooms that have none yet
  setInterval(() => catalog.refreshTitles(store.db), 30_000).unref(); // room titles follow the talk on now
  store.startAutosave();
  require('./src/heat').startMirror(() => store.db); // anonymous check-ins into Elasticsearch for the zone heatmap
  // The sweeper (rule 2): expires offers and passes them on, times out confirms and venue admissions.
  setInterval(() => engine.sweep(), 2000).unref();
  const server = app.listen(PORT, () => {
    console.log(`RightRoom listening on http://localhost:${PORT} (store: ${store.mode})`);
    if (!process.env.DEMO_PASSWORD) console.log('Demo users dana (organiser), leo (staff), sam (attendee); password "rightroom-demo" (set DEMO_PASSWORD to change).');
  });

  // Kubernetes sends SIGTERM before it stops the pod. The OpenTelemetry loader also listens for it and flushes
  // traces, but doesn't exit, so without this a rollout waits out the whole grace period. Stop taking requests, save
  // the state one last time, and let Node exit by itself once that and the trace flush are done. Open stream
  // connections never end on their own, so after 5 seconds exit anyway.
  process.on('SIGTERM', () => {
    server.close();
    server.closeIdleConnections();
    store.flush();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

if (require.main === module) main();

module.exports = { app, engine, store };

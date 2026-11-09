const path = require('node:path');
const express = require('express');
const store = require('./src/mock/store');
const auth = require('./src/auth');
const stream = require('./src/stream');
const { createEngine } = require('./src/engine');
const { redirect } = require('./src/mock/redirect');
const { api } = require('./src/routes/api');

const PORT = process.env.PORT || 3000;
const engine = createEngine({ store, redirect, publish: stream.publish });
auth.ensureDemoUsers(store.db);

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(auth.middleware(store));

app.get('/health', (req, res) => {
  // version is the image's commit (set by the build), so a deploy can be checked from outside.
  res.json({ status: 'ok', service: 'rightroom', version: process.env.APP_VERSION || 'dev' });
});
app.use('/api', api({ store, engine }));
app.use('/api', require('./src/routes/insights').makeRouter({ requireRole: auth.requireRole, db: () => store.db }));

// Screen URLs from docs/journey-map.md, each served by one page in public/.
const PAGES = {
  '/login': 'login', '/me': 'me', '/event': 'event', '/sessions': 'sessions', '/news': 'news',
  '/r/:room': 'room', '/r/:room/in': 'in',
  '/staff/room/:room': 'staff-room', '/staff/setup': 'staff-setup', '/screen/:room': 'screen', '/sim': 'sim',
};
for (const [url, page] of Object.entries(PAGES)) {
  app.get(url, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`), (e) => e && res.status(404).send('Page not built yet.')));
}
app.get('/', (req, res) => res.redirect('/event'));
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  setInterval(() => engine.sweep(), 2000).unref();
  const server = app.listen(PORT, () => {
    console.log(`RightRoom listening on http://localhost:${PORT}`);
    if (!process.env.DEMO_PASSWORD) console.log('Demo users dana (organiser), leo (staff), sam (attendee); password "rightroom-demo" (set DEMO_PASSWORD to change).');
  });

  // Kubernetes sends SIGTERM before it stops the pod. The OpenTelemetry loader also listens for it (to flush
  // traces) but doesn't exit, so without this a rollout waits out the whole grace period. Stop taking requests,
  // then exit; long-lived stream connections get 5 seconds, which also gives OpenTelemetry time to flush.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

module.exports = { app, engine, store };

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
  res.json({ status: 'ok', service: 'rightroom' });
});
app.use('/api', api({ store, engine }));

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
  setInterval(() => engine.sweep(), 2000);
  app.listen(PORT, () => {
    console.log(`RightRoom listening on http://localhost:${PORT}`);
    if (!process.env.DEMO_PASSWORD) console.log('Demo users dana (organiser), leo (staff), sam (attendee); password "rightroom-demo" (set DEMO_PASSWORD to change).');
  });
}

module.exports = { app, engine, store };

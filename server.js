const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('RightRoom is running');
});

app.get('/health', (req, res) => {
  // version is the image's commit (set by the build), so a deploy can be checked from outside.
  res.json({ status: 'ok', service: 'rightroom', version: process.env.APP_VERSION || 'dev' });
});

const server = app.listen(PORT, () => {
  console.log(`RightRoom listening on http://localhost:${PORT}`);
});

// Kubernetes sends SIGTERM before it stops the pod. The OpenTelemetry loader also listens for it and flushes
// traces, but doesn't exit, so without this a rollout waits out the whole grace period. Stop taking requests
// and let Node exit by itself once the last request is done and OpenTelemetry has flushed. Open stream
// connections never end on their own, so after 5 seconds exit anyway.
process.on('SIGTERM', () => {
  server.close();
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
});

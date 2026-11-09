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

// Kubernetes sends SIGTERM before it stops the pod. The OpenTelemetry loader also listens for it (to flush
// traces) but doesn't exit, so without this a rollout waits out the whole grace period. Stop taking requests,
// then exit; long-lived stream connections get 5 seconds, which also gives OpenTelemetry time to flush.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
});

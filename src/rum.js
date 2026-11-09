// Browser monitoring (Dash0 website monitoring, also called RUM). The server's only jobs here:
//   GET /api/rum-config          the settings public/rum.js needs, or {enabled:false}
//   GET /vendor/dash0-sdk-web.js the Dash0 Web SDK file, served from our own host so a venue network that
//                                blocks a CDN cannot switch monitoring off
//
// Monitoring is off unless DASH0_BROWSER_TOKEN is set, so CI and a clean clone are unaffected.
//
// About that token: a browser has to be handed it, so anyone who opens a page can read it. That is how browser
// monitoring works, which is why it must be a SEPARATE Dash0 token with only the "Ingesting" permission, limited
// to one dataset, never the server's DASH0_TOKEN. It is kept out of git: it only lives in the environment.
const path = require('node:path');
const express = require('express');

const SDK_FILE = path.join(__dirname, '..', 'node_modules', '@dash0', 'sdk-web', 'dist', 'dash0.iife.js');

// The server sends traces over gRPC (DASH0_OTLP_ENDPOINT, port 4317). A browser can only use OTLP over HTTP. Dash0
// serves that on the same host over plain HTTPS (port 443), which also gets through venue networks that block odd
// ports. Checked 2026-11-09 against the real endpoint: preflight 204 with any origin allowed, an empty trace with
// the browser token 200, a wrong token 401. Set DASH0_BROWSER_ENDPOINT to override.
function defaultEndpoint(otlpEndpoint) {
  try {
    const u = new URL(String(otlpEndpoint).trim());
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return '';
  }
}

function rumConfig(env = process.env) {
  const token = (env.DASH0_BROWSER_TOKEN || '').trim();
  if (!token) return { enabled: false };
  const url = (env.DASH0_BROWSER_ENDPOINT || '').trim().replace(/\/+$/, '') || defaultEndpoint(env.DASH0_OTLP_ENDPOINT);
  if (!url) return { enabled: false }; // a token but nowhere to send to
  return {
    enabled: true,
    // Separate from the server's service "rightroom", so Dash0 shows the browser and the server side by side.
    serviceName: (env.DASH0_BROWSER_SERVICE_NAME || 'rightroom-web').trim(),
    serviceVersion: env.APP_VERSION || 'dev',
    environment: env.NODE_ENV || 'development',
    endpoint: { url, authToken: token },
  };
}

function router() {
  const r = express.Router();
  r.get('/api/rum-config', (req, res) => {
    res.set('Cache-Control', 'no-store'); // read the environment each time; never serve a stale token
    res.json(rumConfig());
  });
  r.get('/vendor/dash0-sdk-web.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(SDK_FILE, (e) => { if (e && !res.headersSent) res.status(404).end(); });
  });
  return r;
}

module.exports = { rumConfig, router, defaultEndpoint, SDK_FILE };

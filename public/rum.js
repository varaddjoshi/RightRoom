// Browser monitoring (Dash0 website monitoring). Loaded by public/app.js on every screen. P4 owns this file.
// It does nothing unless the server has DASH0_BROWSER_TOKEN set (GET /api/rum-config says {enabled:false}).
// What the SDK records: page loads and timings, web vitals, JavaScript errors, and fetch calls. Fetch calls to our
// own API carry a trace header, so Dash0 links the phone's request to the server span it caused.
// We never call identify(): the SDK gets no handle or name, only the random session it makes itself.
// Monitoring must never break a screen, so everything here is wrapped and fails quietly.
(async () => {
  try {
    const res = await fetch('/api/rum-config', { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg || !cfg.enabled) return;

    // The SDK file replays commands queued on window.dash0 when it loads, so queue init first.
    window.dash0 = window.dash0 || function () { (window.dash0._q = window.dash0._q || []).push(arguments); };
    window.dash0('init', {
      serviceName: cfg.serviceName,
      serviceVersion: cfg.serviceVersion,
      environment: cfg.environment,
      endpoint: cfg.endpoint,
    });

    const s = document.createElement('script');
    s.src = '/vendor/dash0-sdk-web.js';
    s.async = true;
    document.head.appendChild(s);
  } catch (e) {
    /* monitoring is optional */
  }
})();

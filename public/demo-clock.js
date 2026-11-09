// "Demo clock" label. Loaded by public/app.js on every screen. P4 owns this file.
// When the server runs on a demo clock (DEMO_CLOCK, src/clock.js), schedules, "upcoming" and open doors are judged from
// a stand-in time, not real time. This shows a small badge saying so, with the stand-in time ticking forward.
// It does nothing on a normal server, and it must never break a screen, so everything is wrapped and fails quietly.
(async () => {
  try {
    const res = await fetch('/api/clock', { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    const c = await res.json();
    if (!c || !c.demo) return;

    const offset = Date.parse(c.now) - Date.now(); // demo time = real time + offset
    const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });

    const el = document.createElement('div');
    el.id = 'rr-demo-clock';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:calc(100vw - 16px);'
      + 'padding:6px 10px;border:1.5px solid #8a6d00;border-radius:999px;background:#fff6cc;color:#1b1b1b;'
      + 'font:700 12px/1.2 system-ui,-apple-system,sans-serif;pointer-events:none;';
    const paint = () => { el.textContent = `Demo clock · stand-in time ${fmt.format(new Date(Date.now() + offset))}`; };
    paint();
    setInterval(paint, 30_000);
    document.body.appendChild(el);
  } catch (e) {
    /* the label is optional */
  }
})();

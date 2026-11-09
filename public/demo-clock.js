// "Demo clock" chip. Loaded by public/app.js on every screen. P4 owns this file.
// When the server runs on a demo clock (DEMO_CLOCK, src/clock.js), schedules, "upcoming" and open doors are judged from
// a stand-in time, not real time. This shows a small collapsed "Demo" chip in the bottom-right corner; tapping it opens
// the stand-in time (ticking forward) and a one-line explanation. Open/closed is remembered per browser.
// It does nothing on a normal server, and it must never break a screen, so everything is wrapped and fails quietly.
(async () => {
  try {
    const res = await fetch('/api/clock', { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    const c = await res.json();
    if (!c || !c.demo) return;

    const offset = Date.parse(c.now) - Date.now(); // demo time = real time + offset
    const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
    const KEY = 'rr-demo-clock-open';
    let open = false;
    try { open = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked: start collapsed */ }

    // The chip (24px) sits in the bottom padding every screen keeps (32px above the tab bar on phones, 32px on desktop
    // and on screens without tabs), so collapsed it never covers content or the nav.
    const css = `
#rr-demo-clock{position:fixed;z-index:25;right:max(8px,env(safe-area-inset-right,0px));bottom:calc(var(--rr-nav-h,64px) + 4px + env(safe-area-inset-bottom,0px));
 display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:min(300px,calc(100vw - 16px));pointer-events:none}
body.rr-nonav #rr-demo-clock{bottom:calc(4px + env(safe-area-inset-bottom,0px))}
@media (min-width:960px){#rr-demo-clock{bottom:4px;right:12px}}
#rr-demo-clock>*{pointer-events:auto;border:1.5px solid #8a6d00;background:#fff6cc;color:#1b1b1b}
#rr-demo-clock button{min-height:24px;padding:0 10px;border-radius:999px;font:700 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer;opacity:.8}
#rr-demo-clock button:hover,#rr-demo-clock button[aria-expanded=true]{opacity:1}
#rr-demo-clock button:focus-visible{outline:3px solid #1a5fb4;outline-offset:2px;opacity:1}
#rr-demo-clock p{margin:0;padding:8px 10px;border-radius:10px;font:500 12px/1.35 system-ui,-apple-system,sans-serif;box-shadow:0 4px 14px rgb(0 0 0/.15)}
#rr-demo-clock p[hidden]{display:none}`;

    const el = document.createElement('div');
    el.id = 'rr-demo-clock';
    const style = document.createElement('style');
    style.textContent = css;
    const more = document.createElement('p');
    more.id = 'rr-demo-clock-more';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Demo';
    btn.setAttribute('aria-label', 'Demo clock');
    btn.setAttribute('aria-controls', more.id);

    const paint = () => {
      more.textContent = `Stand-in time ${fmt.format(new Date(Date.now() + offset))}. Schedules and open doors run on this demo time, not the real clock.`;
    };
    const set = (v) => {
      open = v;
      btn.setAttribute('aria-expanded', String(v));
      more.hidden = !v;
      try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* not remembered */ }
    };
    btn.addEventListener('click', () => set(!open));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { set(false); btn.focus(); } });

    paint();
    set(open);
    setInterval(paint, 30_000);
    el.appendChild(style);
    el.appendChild(more);
    el.appendChild(btn);
    document.body.appendChild(el);
  } catch (e) {
    /* the label is optional */
  }
})();

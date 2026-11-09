// Shared client helpers for every RightRoom screen. Plain script: exposes window.RR.
// Browser monitoring: /rum.js starts Dash0 website monitoring when the server has a token (P4 owns rum.js).
if (typeof document !== 'undefined') document.head.appendChild(Object.assign(document.createElement('script'), { src: '/rum.js', defer: true }));
(() => {
  const WORD = { free: 'Seats free', filling: 'Filling', full: 'Full' };

  // Escape anything that came from a person (handles, comments, titles) before it goes into innerHTML.
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  // Sends people to /login (keeping where they were going) unless they have one of the roles.
  async function requireLogin(...roles) {
    try {
      const me = await api('/me');
      const ok = !roles.length || roles.includes(me.role) || (me.role === 'organiser' && roles.includes('staff'));
      if (!ok) throw Object.assign(new Error('role'), { status: 403 });
      return me;
    } catch (e) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}${e.status === 403 ? '&role=1' : ''}`;
      return new Promise(() => {});
    }
  }

  // Live updates over server-sent events. EventSource reconnects on its own.
  // Every handled event is acknowledged so the server can time delivery on its own clock (SLO 1).
  function live(space, handlers) {
    const es = new EventSource(`/api/stream?space=${encodeURIComponent(space || '*')}`);
    for (const [type, fn] of Object.entries(handlers)) {
      es.addEventListener(type, (m) => {
        const data = JSON.parse(m.data);
        fn(data);
        api('/ack', { method: 'POST', body: { event_id: data.event_id } }).catch(() => {});
      });
    }
    return es;
  }

  const status = (st, word) => `<span class="rr-status" data-status="${esc(st)}">${esc(word || WORD[st] || st)}</span>`;
  const count = (n, cap) => `<div class="rr-count" aria-label="${Number(n)} of ${Number(cap)} seats taken">${Number(n)}<small>/ ${Number(cap)}</small></div>`;
  const label = (kind) => `<span class="rr-label"${kind === 'live' ? ' data-kind="live"' : ''}>${esc(String(kind).replace(/^./, (c) => c.toUpperCase()))}</span>`;
  const zoneName = (z) => (z ? z.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()) : 'Any seat');

  // Announcements (GET /api/announcements, SSE 'announcement'): shown inside the floor views, not on a separate tab.
  // A floor of null means all floors.
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const notice = (a) => `<div class="rr-announce"${a.urgency === 'urgent' ? ' data-urgency="urgent"' : ''}><span class="rr-eyebrow">${a.urgency === 'urgent' ? 'Urgent' : 'Info'} · ${a.floor == null ? 'All floors' : `Floor ${Number(a.floor)}`} · ${clock(a.at)}</span><span>${esc(a.text)}</span></div>`;
  const urgentFirst = (list) => [...list].sort((a, b) => (b.urgency === 'urgent') - (a.urgency === 'urgent') || b.at - a.at);
  const forFloor = (list, floor) => urgentFirst((list || []).filter((a) => (a.floor ?? null) === floor));

  // One shared modal: native <dialog> gives Esc-to-close and a focus trap; focus goes back to whatever opened it.
  function showNotices(title, list, back) {
    let d = document.getElementById('rr-notices');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'rr-notices';
      d.className = 'rr-dialog';
      d.setAttribute('aria-labelledby', 'rr-notices-h');
      d.addEventListener('close', () => d.back?.focus?.());
      document.body.append(d);
    }
    d.back = back || document.activeElement;
    d.innerHTML = `<h2 class="rr-title" id="rr-notices-h">${esc(title)}</h2>${urgentFirst(list).map(notice).join('')}
      <form method="dialog" class="rr-btn-stack"><button class="rr-btn rr-btn--plain" type="submit" autofocus>Close</button></form>
      <a class="rr-dialog-all" href="/news">All announcements</a>`;
    if (!d.open) d.showModal();
  }

  const badge = (list, floor, label) => list.length
    ? `<button type="button" class="notice-badge"${list.some((a) => a.urgency === 'urgent') ? ' data-urgent' : ''} data-floor="${floor ?? 'all'}" aria-haspopup="dialog">${esc(label)} · ${list.length} ${list.length === 1 ? 'notice' : 'notices'}</button>`
    : '';

  // Live: new urgent announcements for this floor (or all floors) pop up once; everything calls onChange to redraw badges.
  // `floor` null = show urgent notices for every floor (organisers).
  function watchNotices({ floor = null, pop = true, onChange } = {}) {
    const seen = () => { try { return JSON.parse(sessionStorage.getItem('rr-notices-seen') || '[]'); } catch { return []; } };
    const remember = (id) => { try { sessionStorage.setItem('rr-notices-seen', JSON.stringify([...seen(), id])); } catch { /* private mode: may pop again */ } };
    return live('*', {
      announcement: (a) => {
        onChange?.(a);
        const mine = a.floor == null || floor == null || a.floor === floor;
        if (pop && a.urgency === 'urgent' && mine && !seen().includes(a.id)) { remember(a.id); showNotices('Urgent announcement', [a]); }
      },
    });
  }

  // Floor board (A4 map view, S2 floor map, S1 venue board, D1). `floors` is GET /api/floors.
  // opts: { role: 'attendee'|'staff'|'organiser', here: room id, mode: 'map'|'list', notices: GET /api/announcements, onPick: (roomId) => void }. Walking minutes come from GET /api/floors?from=<here>.
  function floorBoard(el, floors, opts = {}) {
    const staff = opts.role === 'staff' || opts.role === 'organiser';
    const needs = (r) => staff && r.queue > 0 && !r.staffOn;
    const access = (r) => `${r.stepFree ? '&#9855; ' : ''}${esc(r.access)}`;
    const extra = (r) => {
      if (staff) return `<span class="tile-m">${r.staffOn ? `${esc(r.staffOn)} on door` : 'No staff'}${r.queue ? ` · Queue ${Number(r.queue)}` : ''}</span>${needs(r) ? '<span class="tile-x">Needs staff</span>' : ''}`;
      if (r.id === opts.here) return '<span class="tile-m">You are here</span>';
      return r.walk != null ? `<span class="tile-m">${Number(r.walk)} min walk</span>` : '';
    };
    const list = opts.mode === 'list';
    const all = forFloor(opts.notices, null);
    const top = all.length ? (list ? `<div class="fl-all">${all.map(notice).join('')}</div>` : `<div class="fl-all">${badge(all, null, 'All floors')}</div>`) : '';
    el.innerHTML = `<div class="fl-board">${top}${floors.map((f) => {
      const seats = f.rooms.reduce((s, r) => s + r.free, 0);
      const mine = forFloor(opts.notices, f.floor);
      const here = f.rooms.some((r) => r.id === opts.here) ? `<span class="here">You are here · Floor ${Number(f.floor)}</span>` : '';
      const head = `<div class="fl-h"><b>Floor ${Number(f.floor)}</b>${here}${list ? '' : badge(mine, f.floor, `Floor ${Number(f.floor)}`)}<span>${f.rooms.length} rooms · ${seats} seats free</span></div>${list ? mine.map(notice).join('') : ''}`;
      const body = list
        ? f.rooms.map((r) => `<div class="talk${needs(r) ? ' alert' : ''}"><div><b>Room ${esc(r.id)} · ${esc(r.title)}</b><span>${r.taken} of ${r.capacity} · ${access(r)}</span>${extra(r).replace(/tile-m|tile-x/g, '')}</div>${status(r.status)}</div>`).join('')
        : `<div class="fl-rooms">${f.rooms.map((r, i) => `<button type="button" class="tile${needs(r) ? ' needs' : ''}" data-room="${esc(r.id)}" data-status="${esc(r.status)}" style="--cap:${Number(r.capacity)};--i:${Math.min(i, 4)}">
            <span class="tile-top"><span class="tile-n">${esc(r.id)}</span>${status(r.status)}</span>
            <span class="tile-t">${esc(r.title)}</span>
            <span class="meter" aria-hidden="true"><i style="width:${Math.min(100, Math.round((r.taken / r.capacity) * 100))}%"></i></span>
            <span class="tile-m">${r.taken} of ${r.capacity}</span><span class="tile-m">${access(r)}</span>${extra(r)}</button>`).join('')}</div>`;
      return `<div class="fl">${head}${body}</div>`;
    }).join('')}</div>`;
    motion(el, opts.mode || 'map');
    if (opts.onPick) el.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => opts.onPick(b.dataset.room)));
    el.querySelectorAll('.notice-badge').forEach((b) => b.addEventListener('click', () => {
      const floor = b.dataset.floor === 'all' ? null : Number(b.dataset.floor);
      showNotices(floor == null ? 'All floors' : `Floor ${floor} notices`, forFloor(opts.notices, floor), b);
    }));
  }

  // Motion: the first render staggers tiles in, switching Map/List cross-fades; live re-renders stay still.
  function motion(el, mode) {
    const first = !el.dataset.rrMode, swapped = !first && el.dataset.rrMode !== mode;
    el.dataset.rrMode = mode;
    if (!first && !swapped) return;
    el.classList.remove('rr-enter', 'rr-swap');
    void el.offsetWidth; // restart the animation
    el.classList.add(first ? 'rr-enter' : 'rr-swap');
    setTimeout(() => el.classList.remove('rr-enter', 'rr-swap'), 400);
  }

  // Motion: pages redraw with innerHTML, so a value is tracked by a stable key (nearest room or id + position),
  // not by node. A changed count or status gets a short tick; a claim code or offer animates when it first appears.
  const WATCH = [['.rr-count', 'rr-tick', 'change'], ['.rr-position strong', 'rr-tick', 'change'], ['.rr-status', 'rr-pulse', 'change'], ['.rr-code', 'rr-reveal', 'appear'], ['.rr-offer', 'rr-arrive', 'appear']];
  const last = new Map();
  function noticeChanges() {
    for (const [sel, cls, when] of WATCH) {
      for (const el of document.querySelectorAll(sel)) {
        if (when === 'appear' && !el.getClientRects().length) continue; // hidden: animate when it is actually shown
        const host = el.closest('[data-room],[id]');
        const key = `${sel}|${host ? host.dataset.room || host.id : ''}|${host ? [...host.querySelectorAll(sel)].indexOf(el) : 0}`;
        const val = sel === '.rr-status' ? el.dataset.status : el.textContent;
        const was = last.get(key);
        last.set(key, val);
        if (when === 'change' ? was !== undefined && was !== val : was !== val) el.classList.add(cls);
      }
    }
  }
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; noticeChanges(); }); } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-status', 'hidden'] });

  // Shows an error next to a form instead of failing silently.
  function showError(el, e) {
    el.textContent = e.message || String(e);
    el.hidden = false;
  }

  // Remembers the last room a person used, so "My seat" and staff "Door" are one tap from anywhere.
  // shortcut: device-only memory; a per-user "my room" API would make it follow people across devices.
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // Line icons, one stroke weight (24px grid).
  const ICON = {
    now: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    map: '<path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
    seat: '<path d="M7 4v8h10V4M5 12h14l-1.5 4H6.5zM7.5 16v4M16.5 16v4"/>',
    me: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/>',
    door: '<path d="M6 20V4h12v16M4 20h16"/><circle cx="14.5" cy="12" r="1"/>',
    board: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    sim: '<path d="M8 5.5v13l10-6.5z"/>',
    in: '<path d="M10 17l5-5-5-5M15 12H4M14 4h5v16h-5"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // One persistent nav per persona: phone tab bar, laptop top bar. Pages opt out with <body class="rr-nonav">.
  let meCache;
  const whoami = () => (meCache ??= api('/me').catch(() => null));
  async function nav() {
    if (document.body.classList.contains('rr-nonav') || document.querySelector('.rr-nav')) return;
    const me = await whoami();
    const room = recall('rr-room'), door = recall('rr-door') || '204';
    const tabs = !me ? [['now', 'Now', '/event'], ['map', 'Schedule', '/sessions'], ['me', 'Sign in', `/login?next=${encodeURIComponent(location.pathname)}`]]
      : me.role === 'organiser' ? [['board', 'Board', '/staff/setup'], ['door', 'Door', `/staff/room/${door}`], ['qr', 'QR codes', '/staff/qr'], ['sim', 'Simulator', '/sim']]
      : me.role === 'staff' ? [['door', 'Door', `/staff/room/${door}`], ['map', 'Schedule', '/sessions'], ['qr', 'QR codes', '/staff/qr'], ['sim', 'Simulator', '/sim']]
      : [['now', 'Now', '/event'], ['map', 'Schedule', '/sessions'], ['seat', 'My seat', room ? `/r/${room}` : '/sessions'], ['me', 'Me', '/me']];
    const path = location.pathname;
    const on = (href) => { const p = href.split('?')[0]; return p === path || (p.startsWith('/r/') && path.startsWith('/r/')) || (p.startsWith('/staff/room/') && path.startsWith('/staff/room/')); };
    const n = document.createElement('nav');
    n.className = 'rr-nav';
    n.setAttribute('aria-label', 'Main');
    n.innerHTML = `<span class="rr-nav-brand"><i aria-hidden="true"></i>RightRoom</span>${tabs.map(([ic, text, href]) => `<a href="${esc(href)}"${on(href) ? ' aria-current="page"' : ''}>${svg(ic)}<span>${esc(text)}</span></a>`).join('')}<span class="rr-here" id="rr-here"></span>`;
    document.body.prepend(n);
  }
  // Laptop top bar shows where you are ("Room 204 · Floor 2"); phones show it in the page header.
  const here = (text) => { const el = document.getElementById('rr-here'); if (el) el.textContent = text ? `You're at ${text}` : ''; };

  // Undo instead of a confirm dialog: the action runs after `ms` unless Undo is pressed.
  function undo(message, run, ms = 5000) {
    document.querySelector('.rr-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'rr-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<p>${esc(message)}</p><button type="button">Undo</button>`;
    document.body.append(t);
    const timer = setTimeout(() => { t.remove(); run(); }, ms);
    t.querySelector('button').addEventListener('click', () => { clearTimeout(timer); t.remove(); });
    t.querySelector('button').focus({ preventScroll: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nav); else nav();

  window.RR = { api, requireLogin, live, status, count, label, zoneName, floorBoard, showError, esc, WORD, notice, forFloor, showNotices, watchNotices, motion, nav, here, undo, remember, recall, svg, whoami };
})();

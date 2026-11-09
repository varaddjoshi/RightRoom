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
  const label = (kind) => `<span class="rr-label"${kind === 'live' ? ' data-kind="live"' : ''}>${esc(String(kind).toUpperCase())}</span>`;
  const zoneName = (z) => (z ? z.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()) : 'Any seat');

  // Floor board (A4 map view, S2 floor map, S1 venue board, D1). `floors` is GET /api/floors.
  // opts: { role: 'attendee'|'staff'|'organiser', here: room id, mode: 'map'|'list', onPick: (roomId) => void }. Walking minutes come from GET /api/floors?from=<here>.
  function floorBoard(el, floors, opts = {}) {
    const staff = opts.role === 'staff' || opts.role === 'organiser';
    const needs = (r) => staff && r.queue > 0 && !r.staffOn;
    const access = (r) => `${r.stepFree ? '&#9855; ' : ''}${esc(r.access)}`;
    const extra = (r) => {
      if (staff) return `<span class="tile-m">${r.staffOn ? `${esc(r.staffOn)} on door` : 'No staff'}${r.queue ? ` · Queue ${Number(r.queue)}` : ''}</span>${needs(r) ? '<span class="tile-x">Needs staff</span>' : ''}`;
      if (r.id === opts.here) return '<span class="tile-m">You are here</span>';
      return r.walk != null ? `<span class="tile-m">${Number(r.walk)} min walk</span>` : '';
    };
    el.innerHTML = floors.map((f) => {
      const seats = f.rooms.reduce((s, r) => s + r.free, 0);
      const here = f.rooms.some((r) => r.id === opts.here) ? `<span class="here">You are here · Floor ${Number(f.floor)}</span>` : '';
      const head = `<div class="fl-h"><b>FLOOR ${Number(f.floor)}</b>${here}<span>${f.rooms.length} rooms · ${seats} seats free</span></div>`;
      const body = opts.mode === 'list'
        ? f.rooms.map((r) => `<div class="talk${needs(r) ? ' alert' : ''}"><div><b>Room ${esc(r.id)} · ${esc(r.title)}</b><span>${r.taken} of ${r.capacity} · ${access(r)}</span>${extra(r).replace(/tile-m|tile-x/g, '')}</div>${status(r.status)}</div>`).join('')
        : `<div class="fl-rooms">${f.rooms.map((r) => `<button type="button" class="tile${needs(r) ? ' needs' : ''}" data-room="${esc(r.id)}" data-status="${esc(r.status)}" style="--cap:${Number(r.capacity)}">
            <span class="tile-top"><span class="tile-n">${esc(r.id)}</span>${status(r.status)}</span>
            <span class="tile-t">${esc(r.title)}</span>
            <span class="meter" aria-hidden="true"><i style="width:${Math.min(100, Math.round((r.taken / r.capacity) * 100))}%"></i></span>
            <span class="tile-m">${r.taken} of ${r.capacity}</span><span class="tile-m">${access(r)}</span>${extra(r)}</button>`).join('')}</div>`;
      return `<div class="fl">${head}${body}</div>`;
    }).join('');
    if (opts.onPick) el.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => opts.onPick(b.dataset.room)));
  }

  // Shows an error next to a form instead of failing silently.
  function showError(el, e) {
    el.textContent = e.message || String(e);
    el.hidden = false;
  }

  window.RR = { api, requireLogin, live, status, count, label, zoneName, floorBoard, showError, esc, WORD };
})();

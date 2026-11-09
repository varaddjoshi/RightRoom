// Injected by scripts/mobile-check.sh into a temp copy of a page. Writes a JSON report into a hidden pre#mobile-report element.
(function () {
  function run() {
    const W = window.innerWidth;
    const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' &&
      !(el.parentElement && el.parentElement.closest('details:not([open])') && !el.closest('summary')); // closed <details> content still reports boxes in Chrome
    const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '') +
      ' "' + (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 30) + '"';
    // Content inside a sideways-scrolling container may sit past the viewport on purpose.
    const inScroller = el => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    const all = [...document.body.querySelectorAll('*')].filter(el => el.id !== 'mobile-report' && shown(el));

    const offscreen = all.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > W + 1 || r.left < -1) && !inScroller(el);
    }).map(name);

    const taps = all.filter(el => el.matches('button, a[href], summary, input:not([type=hidden]), select, textarea, [role=button]'))
      .filter(el => {
        if (el.matches('a') && el.closest('p, li')) return false; // inline links are exempt (WCAG 2.5.8)
        let r = el.getBoundingClientRect();
        const label = el.closest('label');
        if (el.matches('input[type=checkbox], input[type=radio]') && label) r = label.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      }).map(el => { const r = el.getBoundingClientRect(); return name(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`; });

    const smallText = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) &&
      parseFloat(getComputedStyle(el).fontSize) < 12).map(el => name(el) + ' ' + getComputedStyle(el).fontSize);

    // Text or children wider than their own box, e.g. a count pushed under a neighbouring button.
    const spill = all.filter(el => {
      if (el === document.body || el === document.documentElement || inScroller(el)) return false;
      const o = getComputedStyle(el).overflowX;
      return (o === 'visible' || o === 'hidden' || o === 'clip') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2;
    }).map(el => name(el) + ` ${el.scrollWidth}>${el.clientWidth}`);

    // Text covered by a button or link it doesn't belong to (shown as "spill" in the table too).
    const tapEls = all.filter(el => el.matches('button, a[href], summary, [role=button]'));
    const textEls = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    const hit = (a, b) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
    for (const t of textEls) for (const b of tapEls) {
      if (b.contains(t) || t.contains(b)) continue;
      // Text sits on top of the button only if the button is above it in paint order; a covering button is the bug.
      if (hit(t.getBoundingClientRect(), b.getBoundingClientRect())) spill.push(name(t) + ' covered by ' + name(b));
    }

    const wideMedia = all.filter(el => el.matches('img, svg, video, canvas, input, textarea, select') && el.parentElement)
      .filter(el => el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width + 1).map(name);

    const report = {
      width: W,
      height: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > W,
      offscreen, taps, smallText, wideMedia, spill
    };
    const pre = document.createElement('pre');
    pre.id = 'mobile-report';
    pre.hidden = true;
    pre.textContent = JSON.stringify(report);
    document.body.appendChild(pre);
  }
  if (document.readyState === 'complete') setTimeout(run, 500);
  else window.addEventListener('load', () => setTimeout(run, 500));
})();

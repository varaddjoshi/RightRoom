// Run inside each page by scripts/mobile-run.js. Writes a JSON report into a hidden pre#mobile-report element.
(function () {
  function run() {
    // Phones widen the layout viewport to fit overflowing content, so compare against the width under test.
    const W = window.__mobileWidth || window.innerWidth;
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
        // Links inside a sentence are exempt (WCAG 2.5.8); nav and list links are not.
        if (el.matches('a') && [...el.parentElement.childNodes].some(n => n !== el && n.nodeType === 3 && n.textContent.trim())) return false;
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
    // Only counts when the button is really painted on top: elementFromPoint at the middle of the overlap.
    const tapEls = all.filter(el => el.matches('button, a[href], summary, [role=button]'));
    const textEls = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    // Fixed or sticky chrome (tab bar, app bar) stays put while the probe scrolls, so its overlap with content
    // isn't a real covering; skip it on both sides.
    const pinned = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
    for (const t of textEls) for (const b of tapEls) {
      if (b.contains(t) || t.contains(b) || pinned(t) || pinned(b)) continue;
      const a = t.getBoundingClientRect(), c = b.getBoundingClientRect();
      const left = Math.max(a.left, c.left), right = Math.min(a.right, c.right);
      const top = Math.max(a.top, c.top), bottom = Math.min(a.bottom, c.bottom);
      if (right - left < 2 || bottom - top < 2) continue;
      const pageY = (top + bottom) / 2 + scrollY;
      scrollTo(0, pageY - innerHeight / 2);
      const x = (left + right) / 2, y = pageY - scrollY;
      const at = x >= 0 && x < innerWidth ? document.elementFromPoint(x, y) : null;
      if (at && b.contains(at)) spill.push(name(t) + ' covered by ' + name(b));
    }
    scrollTo(0, 0);

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

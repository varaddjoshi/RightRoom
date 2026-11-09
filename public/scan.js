// In-app QR scanner: camera + BarcodeDetector, falling back to jsQR (loaded only when needed).
(function () {
  // Only our own door, room and staff links; anything else could send people to another site.
  function acceptCode(text, origin) {
    try {
      const u = new URL(String(text || '').trim(), origin);
      if (u.origin !== origin) return null;
      if (!/^\/(r|staff)\//.test(u.pathname)) return null;
      return u.pathname + u.search + u.hash;
    } catch { return null; }
  }

  if (typeof module === 'object' && module.exports) { module.exports = { acceptCode }; return; }

  const $ = (id) => document.getElementById(id);
  const say = (msg) => { $('status').textContent = msg; };
  let stream = null, timer = null, detector = null;
  // What to do with an accepted path: /scan navigates; the room page's overlay checks in without leaving.
  let onPath = (path) => { location.href = path; };

  function show(state) {
    document.querySelectorAll('[data-state]').forEach((el) => { el.hidden = !el.dataset.state.split(' ').includes(state); });
  }

  function go(text) {
    const path = acceptCode(text, location.origin);
    if (!path) { say("That code isn't a RightRoom code."); return false; }
    stop();
    if (navigator.vibrate) navigator.vibrate(60);
    say('Opening…');
    onPath(path);
    return true;
  }

  function stop() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsqr.js'; s.onload = ok; s.onerror = () => fail(new Error('Scanner library failed to load'));
      document.head.appendChild(s);
    });
  }

  async function open() {
    if (!window.isSecureContext) { show('insecure'); say('The camera needs a secure (https) page.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { show('nocamera'); say('This browser has no camera access.'); return; }
    show('asking'); say('Asking for camera permission…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      show(denied ? 'denied' : 'nocamera');
      say(denied ? 'Camera permission was denied.' : 'No camera was found.');
      return;
    }
    const video = $('video');
    video.srcObject = stream;
    await video.play().catch(() => {});
    show('scanning'); say('Point the camera at a RightRoom QR code.');
    const track = stream.getVideoTracks()[0];
    $('torch').hidden = !(track.getCapabilities?.().torch);

    if ('BarcodeDetector' in window) {
      try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
    }
    if (!detector) {
      try { await loadJsQR(); } catch (e) { show('nocamera'); say(e.message); stop(); return; }
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    timer = setInterval(async () => {
      if (!video.videoWidth) return;
      let text = null;
      if (detector) {
        const codes = await detector.detect(video).catch(() => []);
        text = codes[0]?.rawValue || null;
      } else {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        text = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
      }
      if (text) go(text);
    }, 125); // about 8 frames a second
  }

  async function torch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const on = $('torch').getAttribute('aria-pressed') !== 'true';
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); $('torch').setAttribute('aria-pressed', on); } catch { say('The torch is not available.'); }
  }

  // Hooks up the scanner markup (ids video, status, torch, retry, paste, link) on the current page.
  function wire(handler) {
    if (handler) onPath = handler;
    $('retry').addEventListener('click', open);
    $('torch').addEventListener('click', torch);
    $('paste').addEventListener('submit', (e) => { e.preventDefault(); go($('link').value); });
    window.addEventListener('pagehide', stop);
  }

  window.RRScan = { open, stop, acceptCode, wire };

  // The standalone /scan page; other pages call RRScan.wire(handler) and RRScan.open() themselves.
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('main.scan')) return;
    wire();
    $('close').addEventListener('click', () => { stop(); history.length > 1 ? history.back() : (location.href = '/'); });
    open();
  });
})();

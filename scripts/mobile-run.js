// Drives an already-running headless Chrome over the DevTools protocol for scripts/mobile-check.sh.
// Usage: node mobile-run.js <devtools port> <shots dir> <widths> <cookie or ""> <page> ...
// Prints one table row per page and size; exits 1 if any row fails.
const fs = require('fs');
const path = require('path');

const [port, shots, widths, cookie, ...pages] = process.argv.slice(2);
const probe = fs.readFileSync(path.join(__dirname, 'mobile-probe.js'), 'utf8');
const log = path.join(shots, 'details.log');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const row = (...c) => console.log(`${String(c[0]).slice(0, 34).padEnd(34)} ${String(c[1]).padStart(10)}  ${c.slice(2).join(' ')}`);

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cannot reach Chrome')); });
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else waiters.filter(w => w.method === m.method).forEach(w => w.res(m.params));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const once = (method, ms) => new Promise((res, rej) => {
    const w = { method, res: p => { clearTimeout(t); waiters.splice(waiters.indexOf(w), 1); res(p); } };
    const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`no ${method} in ${ms / 1000}s`)); }, ms);
    waiters.push(w);
  });
  return { ws, send, once };
}

function url(page) {
  if (/^https?:\/\//.test(page)) return page;
  const abs = path.resolve(page);
  if (!fs.existsSync(abs)) throw new Error(`missing file ${page}`);
  return 'file://' + abs;
}

async function check(cdp, page, size) {
  const [w, hGiven] = size.split('x').map(Number);
  const h = hGiven || (w >= 1000 ? 800 : 844);
  const target = url(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 1000 });
  if (cookie && /^https?:/.test(target)) {
    const [name, ...v] = cookie.split('=');
    const ok = await cdp.send('Network.setCookie', { name: name.trim(), value: v.join('='), url: target });
    if (!ok.success) throw new Error('Chrome refused the cookie');
  }
  const loaded = cdp.once('Page.loadEventFired', 30000);
  const nav = await cdp.send('Page.navigate', { url: target });
  if (nav.errorText) throw new Error(`could not load (${nav.errorText})`);
  await loaded;
  await sleep(1500); // let the page's own scripts fetch data and render
  await cdp.send('Runtime.evaluate', { expression: `window.__mobileWidth = ${w};\n` + probe });
  let report;
  for (let i = 0; i < 40 && !report; i++) {
    await sleep(200);
    const r = await cdp.send('Runtime.evaluate', { expression: "document.getElementById('mobile-report')?.textContent || ''", returnByValue: true });
    if (r.result.value) report = JSON.parse(r.result.value);
  }
  if (!report) throw new Error('probe gave no report (page script error?)');

  await cdp.send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' });
  const shotH = Math.max(h, Math.min(report.height, 16000));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: shotH, scale: 1 } });
  const slug = page.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  fs.writeFileSync(path.join(shots, `${slug}-${size}.png`), Buffer.from(shot.data, 'base64'));
  return { h, report };
}

(async () => {
  fs.writeFileSync(log, '');
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  row('PAGE', 'SIZE', 'OVERFLOW  OFF TAPS TEXT WIDE SPILL  RESULT');
  let total = 0, passed = 0;
  for (const page of pages) for (const size of widths.split(',')) {
    total++;
    try {
      const { h, report: r } = await check(cdp, page, size);
      const bad = r.overflow || r.offscreen.length || r.taps.length || r.smallText.length || r.wideMedia.length || r.spill.length;
      const cells = [(r.overflow ? 'yes' : 'no').padEnd(8), ...[r.offscreen, r.taps, r.smallText, r.wideMedia].map(a => String(a.length).padStart(4)), String(r.spill.length).padStart(5)];
      row(page, `${size.split('x')[0]}x${h}`, cells.join(' '), ' ' + (bad ? 'FAIL' : 'pass'));
      if (bad) {
        const lines = ['offscreen', 'taps', 'smallText', 'wideMedia', 'spill'].flatMap(k => r[k].slice(0, 8).map(x => `    ${k}: ${x}`));
        console.log(lines.join('\n'));
        fs.appendFileSync(log, `${page} ${size}\n${lines.join('\n')}\n`);
      } else passed++;
    } catch (e) {
      row(page, size, `FAIL (${e.message})`);
      fs.appendFileSync(log, `${page} ${size}: ${e.stack}\n`);
    }
  }
  console.log(`\n${passed} of ${total} passed. Screenshots and details.log: ${shots}`);
  cdp.ws.close();
  process.exit(passed === total ? 0 : 1);
})().catch(e => { console.log(`FAIL (${e.message})`); process.exit(1); });

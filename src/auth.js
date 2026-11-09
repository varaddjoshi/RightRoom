// Username + password login with roles. Passwords: scrypt with a per-user salt. Sessions: HMAC-signed httpOnly cookie.
// No email, name or phone is stored; the username is the public handle.
const crypto = require('node:crypto');

// SESSION_SECRET keeps people signed in across restarts. Without it the store (src/store.js) keeps a generated one
// with the saved state when Elasticsearch is on; in memory only, a random secret per boot logs everyone out.
let SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
function setSecret(secret) { if (!process.env.SESSION_SECRET && secret) SECRET = secret; }
const DAY = 24 * 3600_000;
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const ORGANISERS = list(process.env.ORGANISERS, 'dana');
const STAFF = list(process.env.STAFF, 'leo');
const HANDLE = /^[a-z0-9][a-z0-9-]{2,23}$/;
const NEEDS = ['step-free', 'captions'];
const DEMO = ['dana', 'leo', 'sam'];

const roleFor = (h) => (ORGANISERS.includes(h) ? 'organiser' : STAFF.includes(h) ? 'staff' : 'attendee');

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}

function addUser(db, handle, password, extra = {}) {
  db.users.set(handle, { handle, role: roleFor(handle), interests: [], needs: [], ...hash(password), ...extra });
  return db.users.get(handle);
}

// Demo accounts for the walkthrough. The password comes from .env; the default is printed at boot.
function ensureDemoUsers(db) {
  const pw = process.env.DEMO_PASSWORD || 'rightroom-demo';
  if (!db.users.has('dana')) addUser(db, 'dana', pw);
  if (!db.users.has('leo')) addUser(db, 'leo', pw);
  if (!db.users.has('sam')) addUser(db, 'sam', pw, { interests: ['kubernetes', 'observability', 'ebpf'], needs: ['step-free'] });
}

function signup(db, handle, password) {
  handle = String(handle || '').toLowerCase();
  if (!HANDLE.test(handle) || handle.startsWith('guest-') || handle.startsWith('stand-in')) throw bad('Pick a username of 3 to 24 letters, numbers or hyphens.');
  if (String(password || '').length < 8) throw bad('Use a password of at least 8 characters.');
  // Staff and organiser roles come from the allowlists, so those names (and the demo accounts) can't be claimed by signing up.
  if (ORGANISERS.includes(handle) || STAFF.includes(handle) || DEMO.includes(handle)) throw bad('That username is reserved.', 409);
  if (db.users.has(handle)) throw bad('That username is taken.', 409);
  return addUser(db, handle, String(password));
}

function login(db, handle, password) {
  const u = db.users.get(String(handle || '').toLowerCase());
  const ok = u && u.hash && crypto.timingSafeEqual(Buffer.from(hash(String(password || ''), u.salt).hash, 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) throw bad('Wrong username or password.', 401);
  return u;
}

function guest(db) {
  const handle = `guest-${crypto.randomBytes(3).toString('hex')}`;
  db.users.set(handle, { handle, role: 'guest', interests: [], needs: [] });
  return db.users.get(handle);
}

function sign(handle) {
  const body = `${handle}.${Date.now() + DAY}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

function verify(token) {
  const [handle, exp, sig] = String(token || '').split('.');
  if (!handle || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${handle}.${exp}`).digest('base64url');
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? handle : null;
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const COOKIE = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=86400';
function setSession(res, user) {
  res.append('Set-Cookie', `rr=${sign(user.handle)}; ${COOKIE}`);
}
function clearSession(res) { res.append('Set-Cookie', 'rr=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }

// Adds req.user (or null) and a stable device id for guests (decision 28).
function middleware(store) {
  return (req, res, next) => {
    const c = cookies(req);
    const handle = verify(c.rr);
    req.user = handle ? store.db.users.get(handle) || null : null;
    req.device = c.rrd;
    if (!req.device) { req.device = crypto.randomBytes(8).toString('hex'); res.append('Set-Cookie', `rrd=${req.device}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`); }
    next();
  };
}

// Organisers can do anything staff can.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    const r = req.user.role;
    if (roles.includes(r) || (r === 'organiser' && roles.includes('staff'))) return next();
    res.status(403).json({ error: 'Your role cannot do this.' });
  };
}

function publicUser(u) { return u && { handle: u.handle, role: u.role, interests: u.interests, needs: u.needs }; }

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }

module.exports = { signup, login, guest, setSession, clearSession, middleware, requireRole, publicUser, ensureDemoUsers, NEEDS, verify, sign, setSecret };

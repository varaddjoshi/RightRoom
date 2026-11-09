// Where the engine's state lives (P2).
//
// Without ELASTICSEARCH_URL this is the in-memory mock store, exactly as before: state is lost on restart, which is
// what tests, CI and a fresh clone want.
//
// With ELASTICSEARCH_URL the engine still works on the same in-memory state (one process, one replica, so two
// requests can never race for a seat), and that state is saved to Elasticsearch as one document, within about a
// second of any change, and loaded back on start. A deploy or restart then keeps queues, offers, check-ins, accounts
// and sign-ins.
//
// Which index: STATE_INDEX if set. The cluster's Deployment sets STATE_INDEX=rr_engine_state, the demo's state.
// Anywhere else the default is a per-user index, <ES_INDEX_PREFIX>engine_state_local_<user>, because the whole team
// shares one Elasticsearch cluster: a laptop with the team's .env must never restore and then overwrite the demo.
//
// shortcut: this does not write P1's per-entity indexes (rr_spaces, rr_queue, ...) yet; that waits on P1 and P2
// agreeing which room ids the demo uses.
const crypto = require('node:crypto');
const os = require('node:os');
const store = require('./mock/store'); // the engine reads store.db; store.reset() re-seeds ("Reset demo")
const { seedInto } = require('./mock/insights-seed');

const SAVE_EVERY_MS = 1000;
const FORMAT = 1; // bump when the shape of store.db changes, so an old save is ignored instead of misread
const EVENT_ID = process.env.EVENT_ID || 'cnh-2026';
const PREFIX = process.env.ES_INDEX_PREFIX || 'rr_';
const localUser = () => { try { return os.userInfo().username; } catch { return 'unknown'; } };
const INDEX = (process.env.STATE_INDEX || `${PREFIX}engine_state_local_${localUser()}`).toLowerCase().replace(/[^a-z0-9_.-]/g, '_');

// store.db holds Maps (spaces, offers, users, check-ins per room), which JSON can't carry on its own.
const toJSON = (db) => JSON.stringify(db, (k, v) => (v instanceof Map ? { $map: [...v] } : v));
const fromJSON = (s) => JSON.parse(s, (k, v) => (v && typeof v === 'object' && Array.isArray(v.$map) ? new Map(v.$map) : v));

store.mode = 'memory';
store.sessionSecret = null;

let client = null;
let lastSaved = null;
let saving = null;
let failures = 0;
let timer = null;

function es() {
  if (!client) {
    const { Client } = require('@elastic/elasticsearch');
    const apiKey = process.env.ELASTICSEARCH_API_KEY;
    client = new Client({ node: process.env.ELASTICSEARCH_URL, auth: apiKey ? { apiKey } : undefined, requestTimeout: 10_000 });
  }
  return client;
}

// Only the bookkeeping fields are mapped; the state itself stays in _source, unindexed (dynamic: false).
async function ensureIndex() {
  if (await es().indices.exists({ index: INDEX })) return;
  try {
    await es().indices.create({
      index: INDEX,
      mappings: { dynamic: false, properties: { event_id: { type: 'keyword' }, format: { type: 'integer' }, saved_at: { type: 'date' } } },
    });
  } catch (e) {
    if (e?.meta?.body?.error?.type !== 'resource_already_exists_exception') throw e;
  }
}

// Called once at boot, before the server listens. Never throws: if Elasticsearch can't be reached after a few tries,
// the app runs in memory and saves nothing, so a broken cluster can't overwrite good saved state with a fresh seed.
async function restore({ attempts = 5, log = console } = {}) {
  if (!process.env.ELASTICSEARCH_URL) {
    log.log('[store] ELASTICSEARCH_URL not set: state is in memory only and resets on restart.');
    return store.mode;
  }
  for (let i = 1; ; i++) {
    try {
      await ensureIndex();
      if (process.env.RESET_STATE === '1') {
        log.log(`[store] RESET_STATE=1: starting from the seed; it replaces the saved state in ${INDEX}.`);
      } else {
        const doc = await es().get({ index: INDEX, id: EVENT_ID }, { ignore: [404] });
        if (doc.found && doc._source.format === FORMAT) {
          store.db = fromJSON(doc._source.state);
          store.sessionSecret = doc._source.session_secret || null;
          // A state saved before the insights stand-ins existed would leave the Wi-Fi and topics panels empty.
          if (!store.db.wifi?.length && !store.db.comments?.length) seedInto(store.db);
          log.log(`[store] Restored state saved at ${doc._source.saved_at} from ${INDEX}/${EVENT_ID}.`);
        } else if (doc.found) {
          log.log(`[store] Saved state has format ${doc._source.format}, this build uses ${FORMAT}: starting from the seed.`);
        } else {
          log.log(`[store] No saved state in ${INDEX}/${EVENT_ID} yet: starting from the seed.`);
        }
      }
      store.mode = 'elasticsearch';
      break;
    } catch (e) {
      if (i >= attempts) {
        log.error(`[store] Elasticsearch unreachable (${e.message}). Running in memory only; nothing will be saved.`);
        store.mode = 'memory (elasticsearch unreachable)';
        return store.mode;
      }
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  // Without SESSION_SECRET, keep one generated secret with the state, so sign-ins survive a restart.
  if (!store.sessionSecret) store.sessionSecret = crypto.randomBytes(32).toString('hex');
  return store.mode;
}

// Saves when anything changed since the last save. One save at a time; the next tick picks up later changes.
function save() {
  if (store.mode !== 'elasticsearch' || saving) return saving || Promise.resolve(false);
  const state = toJSON(store.db);
  if (state === lastSaved) return Promise.resolve(false);
  saving = es()
    .index({ index: INDEX, id: EVENT_ID, document: { event_id: EVENT_ID, format: FORMAT, saved_at: new Date().toISOString(), state, session_secret: store.sessionSecret } })
    .then(() => { lastSaved = state; failures = 0; return true; })
    .catch((e) => { if (failures++ % 30 === 0) console.error(`[store] Save to ${INDEX} failed: ${e.message}`); return false; })
    .finally(() => { saving = null; });
  return saving;
}

function startAutosave() {
  if (store.mode === 'elasticsearch' && !timer) timer = setInterval(save, SAVE_EVERY_MS).unref();
}

// Last save on shutdown: waits for one in flight, then saves anything newer.
async function flush() {
  if (timer) { clearInterval(timer); timer = null; }
  if (saving) await saving;
  return save();
}

Object.assign(store, { restore, save, flush, startAutosave, toJSON, fromJSON, INDEX, EVENT_ID });
module.exports = store;

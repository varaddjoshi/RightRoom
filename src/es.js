// Elasticsearch client, index names and mappings for RightRoom (P1).
// Every other module gets the client and index names from here, never builds them itself.
//
// Env:
//   ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY  the cluster
//   ES_INDEX_PREFIX      prefix for every index (default "rr_"); the load test uses "rr_test_"
//   ES_SEMANTIC          "off" maps session text as plain text when the cluster has no inference endpoint
//   ES_INFERENCE_ID      inference endpoint for semantic_text (default: the cluster's default ELSER endpoint)
//
// The caller loads .env (server.js or a script); this module only reads process.env.

const { Client } = require('@elastic/elasticsearch');

const PREFIX = process.env.ES_INDEX_PREFIX || 'rr_';
const SEMANTIC = (process.env.ES_SEMANTIC || 'on').toLowerCase() !== 'off';

let client;
function es() {
  if (!client) {
    if (!process.env.ELASTICSEARCH_URL) throw new Error('ELASTICSEARCH_URL is not set');
    client = new Client({
      node: process.env.ELASTICSEARCH_URL,
      auth: process.env.ELASTICSEARCH_API_KEY ? { apiKey: process.env.ELASTICSEARCH_API_KEY } : undefined,
    });
  }
  return client;
}

// Short names used in code -> real index names.
const NAMES = ['spaces', 'queue', 'offers', 'checkins', 'sessions', 'announcements', 'users', 'comments', 'wifi_readings'];
const INDEX = Object.fromEntries(NAMES.map((n) => [n, PREFIX + n]));

const keyword = { type: 'keyword' };
const int = { type: 'integer' };
const date = { type: 'date' };
const bool = { type: 'boolean' };
const text = { type: 'text' };
const textKw = { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 256 } } };
const notIndexed = { type: 'keyword', index: false, doc_values: false };

// Fields every document carries.
const base = { event_id: keyword, created_at: date, updated_at: date };

// Access needs are preferences, never a diagnosis: "step_free", "captions", "front_row", "access_seat".
const needs = keyword;

const semanticField = SEMANTIC
  ? { type: 'semantic_text', ...(process.env.ES_INFERENCE_ID ? { inference_id: process.env.ES_INFERENCE_ID } : {}) }
  : text;

const MAPPINGS = {
  // One document per scarce space: the venue, each room (and tables, an Extra).
  spaces: {
    ...base,
    type: keyword, // venue | room | table
    name: textKw,
    floor: int,
    capacity: int,
    taken: int, // check-ins + held seats (open offers); the engine changes it with scripted updates only
    access_seats: int, // seats only for people who stated the need
    access_taken: int,
    status: keyword, // seats_free | filling | full
    status_source: keyword, // checkins | staff | override
    full_suggested_at: date, // when the app suggested Full and is waiting for staff to confirm
    rule: text, // the published admission rule, shown word for word
    priorities: keyword, // publicly listed priorities, e.g. "access_needs"
    step_free: bool,
    captions: bool,
    overflow_space_id: keyword,
    stream_url: notIndexed,
    zones: {
      type: 'nested',
      properties: { name: keyword, capacity: int, taken: int },
    },
    // Walking time from this space to each other space, for redirects.
    walks: {
      type: 'nested',
      properties: { to: keyword, minutes: int, step_free: bool },
    },
  },

  queue: {
    ...base,
    space_id: keyword,
    handle: keyword,
    position: int,
    arrived_at: date,
    needs,
    priority: bool,
    status: keyword, // waiting | offered | admitted | remote_only | left
    reason: text, // shown to the person, e.g. "admitted in order of arrival"
    device_id: keyword,
    admission_expires_at: date, // venue only
  },

  offers: {
    ...base,
    space_id: keyword,
    queue_id: keyword,
    handle: keyword,
    zone: keyword,
    access_seat: bool,
    held_until: date,
    status: keyword, // offered | claimed | expired | passed_on | checked_in
    claim_code: keyword,
  },

  // Deleted when the session ends.
  checkins: {
    ...base,
    space_id: keyword,
    session_id: keyword,
    handle: keyword,
    zone: keyword,
    at: date,
  },

  sessions: {
    ...base,
    title: textKw,
    abstract: text,
    speakers: textKw,
    tags: keyword,
    track: keyword,
    level: keyword,
    room_id: keyword,
    start: date,
    end: date,
    // Title + abstract + tags, embedded by Elasticsearch, used by the redirect query.
    topic: semanticField,
  },

  announcements: {
    ...base,
    text,
    floor: int,
    urgency: keyword, // info | important | urgent
    at: date,
    author_handle: keyword,
  },

  users: {
    ...base,
    handle: keyword,
    password_hash: notIndexed,
    password_salt: notIndexed,
    role: keyword, // attendee | host | organiser | guest
    host_space_ids: keyword, // rooms a host is assigned to
    interests: keyword,
    starred_sessions: keyword,
    needs,
  },

  // Extra. The handle is removed after the session.
  comments: {
    ...base,
    session_id: keyword,
    space_id: keyword,
    handle: keyword,
    text,
    hidden: bool,
    at: date,
  },

  // Extra. No handle stored.
  wifi_readings: {
    ...base,
    space_id: keyword,
    zone: keyword,
    floor: int,
    download_mbps: { type: 'float' },
    latency_ms: { type: 'float' },
    at: date,
  },
};

// Single shard, no replicas: one small event, and it keeps a fresh cluster green.
const SETTINGS = { number_of_shards: 1, number_of_replicas: 0 };

// Creates any missing index. Safe to run on every start. Returns the names it created.
async function ensureIndexes() {
  const created = [];
  for (const name of NAMES) {
    const index = INDEX[name];
    if (await es().indices.exists({ index })) continue;
    try {
      await es().indices.create({ index, settings: SETTINGS, mappings: { properties: MAPPINGS[name] } });
      created.push(index);
    } catch (e) {
      // Another process created it first.
      if (e?.meta?.body?.error?.type !== 'resource_already_exists_exception') throw e;
    }
  }
  return created;
}

// Deletes every index with this prefix. For the seed script and the load test, never the server.
async function dropIndexes() {
  for (const name of NAMES) {
    await es().indices.delete({ index: INDEX[name], ignore_unavailable: true });
  }
}

module.exports = { es, INDEX, MAPPINGS, PREFIX, SEMANTIC, ensureIndexes, dropIndexes };

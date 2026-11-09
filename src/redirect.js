// The redirect query (P1): where to send people when a room is full, and why.
//
// redirect({ spaceId, groupSize, needs, interests, now }) returns
//   { from, current_session, suggestion, alternatives, rejected, something_different, overflow, generated_at }
//
// Hard rules (a room that fails one is listed in `rejected` with the reason, never suggested):
//   - free seats (capacity - taken; open offers are already in taken) cover the whole group (rule 3)
//   - not Full
//   - step-free route and room when the person needs step_free; live captions when they need captions;
//     a free accessibility seat when they need access_seat
//   - a session whose door window (decision 32) is open now or opens within 20 minutes, and stays open long
//     enough to claim and scan in: 5 minutes, or 15 for anyone with a stated access need (decision 31)
// Ranking among the rest: topic match to the full room's session, then walking minutes, then free seats.
// Interests only break ties inside the same topic band; they never decide who gets a seat (rule 5).
//
// This only reads. The engine (P2) reserves the seats as offers for whoever it redirects.

const { es, INDEX, SEMANTIC } = require('./es');

const MIN = 60 * 1000;
const OPENING_SOON_MIN = 20;
const SCAN_MIN = 5;
const SCAN_MIN_ACCESS = 15;

function freeSeats(space) {
  return Math.max(0, (space.capacity || 0) - (space.taken || 0));
}

function walkTo(from, toId, to) {
  const w = (from.walks || []).find((x) => x.to === toId);
  if (w) return { minutes: w.minutes, step_free: w.step_free !== false && !!to.step_free, estimated: false };
  // No walking time stored: estimate 2 minutes per floor plus 2, and only call it step-free if the room is.
  return { minutes: 2 + 2 * Math.abs((from.floor || 0) - (to.floor || 0)), step_free: !!to.step_free, estimated: true };
}

// The session on in this room right now, if any.
async function currentSession(spaceId, now) {
  const res = await es().search({
    index: INDEX.sessions,
    size: 1,
    query: { bool: { filter: [
      { term: { room_id: spaceId } },
      { range: { start: { lte: now.toISOString() } } },
      { range: { end: { gt: now.toISOString() } } },
    ] } },
    _source: { excludes: ['topic'] },
  });
  const hit = res.hits.hits[0];
  return hit ? { id: hit._id, ...hit._source } : null;
}

// Sessions in other rooms that someone could walk into now, scored by topic similarity.
async function candidateSessions({ spaceId, now, queryText, scanMin }) {
  const filter = [
    { range: { door_close_at: { gt: new Date(now.getTime() + scanMin * MIN).toISOString() } } },
    { range: { door_open_at: { lte: new Date(now.getTime() + OPENING_SOON_MIN * MIN).toISOString() } } },
  ];
  const must_not = [{ term: { room_id: spaceId } }];
  const base = { index: INDEX.sessions, size: 50, _source: { excludes: ['topic'] } };

  // The text query only scores (should), never filters: every session that passes the time filter comes back,
  // and ones with no match just score 0 and land in the lowest topic band.
  const keywordQuery = queryText
    ? [{ multi_match: { query: queryText, fields: ['title^2', 'abstract', 'tags^2'] } }]
    : [];
  const run = (should) => es().search({ ...base, query: { bool: { should, filter, must_not, minimum_should_match: 0 } } });

  let res;
  let method = 'keyword';
  if (SEMANTIC && queryText) {
    try {
      res = await run([{ semantic: { field: 'topic', query: queryText } }]);
      method = 'semantic';
    } catch (e) {
      // No inference endpoint on this cluster: fall back to keyword matching so redirects still work.
      res = null;
    }
  }
  if (!res) res = await run(keywordQuery);
  if (!queryText) method = 'none';
  return { method, hits: res.hits.hits.map((h) => ({ id: h._id, score: h._score || 0, ...h._source })) };
}

function minutesBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / MIN);
}

function timeReason(session, now) {
  const startsIn = minutesBetween(now, session.start);
  const closesIn = session.door_close_at ? `, door closes in ${minutesBetween(now, session.door_close_at)} min` : '';
  if (startsIn > 0) return `Starts in ${startsIn} min${closesIn}`;
  return `On now${closesIn}`;
}

async function redirect({ spaceId, groupSize = 1, needs = [], interests = [], now = new Date() } = {}) {
  if (!spaceId) throw new Error('spaceId is required');
  groupSize = Math.max(1, Number(groupSize) || 1);
  const needSet = new Set(needs);
  const interestSet = new Set(interests.map((s) => String(s).toLowerCase()));

  const fromDoc = await es().get({ index: INDEX.spaces, id: spaceId });
  const from = { id: spaceId, ...fromDoc._source };
  const current = await currentSession(spaceId, now);

  const queryText = current
    ? `${current.title}. ${current.abstract || ''} ${(current.tags || []).join(' ')}`
    : [...interestSet].join(' ');
  const scanMin = needSet.size ? SCAN_MIN_ACCESS : SCAN_MIN;
  const { method, hits } = await candidateSessions({ spaceId, now, queryText, scanMin });

  // One candidate per room: its best-scoring session.
  const byRoom = new Map();
  for (const s of hits) {
    if (!s.room_id || s.room_id === spaceId) continue;
    const prev = byRoom.get(s.room_id);
    if (!prev || s.score > prev.score) byRoom.set(s.room_id, s);
  }
  const roomIds = [...byRoom.keys()];
  const spaces = roomIds.length
    ? (await es().mget({ index: INDEX.spaces, ids: roomIds })).docs
    : [];
  const maxScore = Math.max(0, ...hits.map((h) => h.score));

  const eligible = [];
  const rejected = [];
  for (const doc of spaces) {
    if (!doc.found) continue;
    const space = { id: doc._id, ...doc._source };
    if (space.type && space.type !== 'room') continue;
    const session = byRoom.get(space.id);
    const free = freeSeats(space);
    const walk = walkTo(from, space.id, space);
    const accessFree = Math.max(0, (space.access_seats || 0) - (space.access_taken || 0));

    let reason = null;
    if (space.status === 'full' || free === 0) reason = 'Full';
    else if (free < groupSize) reason = `Only ${free} seat${free === 1 ? '' : 's'} free, ${groupSize} needed`;
    else if (needSet.has('step_free') && !walk.step_free) reason = 'No step-free route';
    else if (needSet.has('captions') && !space.captions) reason = 'No live captions';
    else if (needSet.has('access_seat') && accessFree < groupSize) reason = 'No accessibility seat free';

    const entry = {
      space_id: space.id,
      space_name: space.name,
      floor: space.floor,
      session_id: session.id,
      title: session.title,
      start: session.start,
      end: session.end,
      tags: session.tags || [],
      free,
      walk_minutes: walk.minutes,
      step_free: walk.step_free,
      captions: !!space.captions,
    };
    if (reason) {
      rejected.push({ ...entry, reason });
      continue;
    }

    const rel = maxScore > 0 ? session.score / maxScore : 0;
    const band = method === 'none' ? 0 : rel >= 0.8 ? 2 : rel >= 0.5 ? 1 : 0;
    const matched = (session.tags || []).filter((t) => interestSet.has(String(t).toLowerCase()));

    const reasons = [];
    if (current && band === 2) reasons.push(`Similar topic to "${current.title}"`);
    else if (current && band === 1) reasons.push('Related topic');
    if (matched.length) reasons.push(`Matches your interests: ${matched.join(', ')}`);
    reasons.push(`${walk.minutes} min walk${walk.step_free ? ', step-free' : ''}${walk.estimated ? ' (estimated)' : ''}`);
    reasons.push(`${free} seat${free === 1 ? '' : 's'} free`);
    if (needSet.has('captions')) reasons.push('Live captions');
    reasons.push(timeReason(session, now));

    eligible.push({ ...entry, topic_score: Number(rel.toFixed(3)), band, interest_matches: matched.length, reasons });
  }

  eligible.sort((a, b) =>
    b.band - a.band ||
    b.interest_matches - a.interest_matches ||
    a.walk_minutes - b.walk_minutes ||
    b.free - a.free ||
    b.topic_score - a.topic_score);

  const suggestion = eligible[0] || null;
  const alternatives = eligible.slice(1, 3);

  // One option on a different topic: the least similar room that still passes every rule.
  const different = eligible
    .filter((e) => e !== suggestion)
    .sort((a, b) => a.topic_score - b.topic_score || a.walk_minutes - b.walk_minutes)[0];
  const something_different = different && (!suggestion || different.band < suggestion.band || method === 'none')
    ? { ...different, reasons: ['Something different', ...different.reasons.filter((r) => !r.startsWith('Similar') && r !== 'Related topic')] }
    : null;

  let overflow = null;
  if (from.overflow_space_id) {
    try {
      const o = await es().get({ index: INDEX.spaces, id: from.overflow_space_id });
      overflow = { space_id: o._id, space_name: o._source.name, free: freeSeats(o._source), stream_url: from.stream_url || null };
    } catch {
      overflow = { space_id: from.overflow_space_id, space_name: null, free: null, stream_url: from.stream_url || null };
    }
  } else if (from.stream_url) {
    overflow = { space_id: null, space_name: null, free: null, stream_url: from.stream_url };
  }

  rejected.sort((a, b) => a.walk_minutes - b.walk_minutes);

  return {
    from: { id: from.id, name: from.name, status: from.status, free: freeSeats(from) },
    current_session: current ? { id: current.id, title: current.title, tags: current.tags || [] } : null,
    group_size: groupSize,
    match_method: method,
    suggestion,
    alternatives,
    rejected,
    something_different,
    overflow,
    generated_at: now.toISOString(),
  };
}

module.exports = { redirect, freeSeats, walkTo };

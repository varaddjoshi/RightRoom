// Aggregations over stand-in insight data. Pure functions.
// shortcut: in-memory stand-ins for Elasticsearch aggregations; P1's queries replace them.
const { topTerms } = require('./topics');

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
}

function wifiMedians(readings) {
  const rooms = {};
  for (const r of readings) {
    const room = (rooms[r.room] ??= { all: [], zones: {} });
    room.all.push(r);
    (room.zones[r.zone] ??= []).push(r);
  }
  const sum = rs => ({ mbps: median(rs.map(r => r.mbps)), ms: median(rs.map(r => r.ms)), readings: rs.length });
  return Object.fromEntries(Object.entries(rooms).map(([id, r]) => [id, {
    ...sum(r.all),
    zones: Object.fromEntries(Object.entries(r.zones).map(([z, rs]) => [z, sum(rs)])),
  }]));
}

// Counts per tag; groups smaller than minGroup are hidden so nobody can be singled out.
function interestCounts(users, labels = {}, minGroup = 5) {
  const counts = new Map();
  for (const u of users) for (const t of new Set(u.interests)) counts.set(t, (counts.get(t) || 0) + 1);
  const all = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    groups: all.filter(([, c]) => c >= minGroup).map(([tag, count]) => ({ tag, label: labels[tag] || tag, count })),
    hiddenGroups: all.filter(([, c]) => c < minGroup).length,
    minGroup,
  };
}

function metrics(log) {
  const redirects = log.filter(e => e.type === 'redirect');
  const prompts = log.filter(e => e.type === 'full_prompt');
  const rate = (n, d) => (d ? Math.round((n / d) * 100) / 100 : null);
  const followed = redirects.filter(e => e.followed).length;
  const overridden = prompts.filter(e => e.answer === 'not_yet').length;
  return {
    redirects: redirects.length, followed, redirectSuccessRate: rate(followed, redirects.length),
    fullPrompts: prompts.length, overridden, overrideRate: rate(overridden, prompts.length),
  };
}

// Topics for a room id or a session title, scored against every comment.
function topicsFor(key, comments, sessions) {
  const s = sessions.find(x => x.room === key || x.title === key);
  if (!s) return null;
  return { room: s.room, title: s.title, topics: topTerms(comments.filter(c => c.room === s.room).map(c => c.text), comments.map(c => c.text)) };
}

module.exports = { wifiMedians, interestCounts, metrics, topicsFor, median };

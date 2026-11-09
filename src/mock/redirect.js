// Mock of the redirect query (P1 builds the Elasticsearch version in src/redirect.js).
// Interests only rank suggestions; they never decide who gets a seat (rule 5).
const HOLD_MS = 10 * 60_000;

function redirect({ db, engine, from, user, now }) {
  const interests = new Set(user.interests || []);
  const stepFree = (user.needs || []).includes('step-free');
  const captions = (user.needs || []).includes('captions');
  const options = [];
  const rejected = [];
  for (const sp of db.spaces.values()) {
    if (sp.type !== 'room' || sp.id === from.id || sp.test) continue; // never send people to a load test room
    sp.redirectHolds = sp.redirectHolds.filter((h) => h.until > now && h.handle !== user.handle);
    // Rule 3: never send more people than there are free seats.
    const free = sp.capacity - engine.taken(sp) - sp.redirectHolds.length;
    const minutes = engine.walk(from, sp);
    const shared = sp.tags.filter((t) => interests.has(t) || from.tags.includes(t));
    const no = (reason) => rejected.push({ room: sp.id, title: sp.title, reason });
    if (stepFree && !sp.stepFree) { no('Stairs only'); continue; }
    if (sp.capacity - engine.taken(sp) < 1) { no('Full'); continue; }
    if (free < 1) { no('No seats left after others were sent there'); continue; }
    options.push({ sp, free, minutes, shared, score: shared.length * 10 - minutes + (captions && sp.captions ? 5 : 0) });
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  const different = options.slice(1).sort((a, b) => a.shared.length - b.shared.length || a.minutes - b.minutes)[0];
  for (const o of options.slice(1)) if (o !== different && rejected.length < 4) rejected.push({ room: o.sp.id, title: o.sp.title, reason: `${o.minutes} minutes away, ${o.shared.length ? 'less similar topic' : 'different topic'}` });
  if (best) best.sp.redirectHolds.push({ handle: user.handle, until: now + HOLD_MS });
  const pick = (o) => o && { room: o.sp.id, title: o.sp.title, floor: o.sp.floor, free: o.free, minutes: o.minutes, access: o.sp.access, stepFree: o.sp.stepFree };
  return {
    suggestion: pick(best),
    reasons: best ? [
      ...(best.shared.length ? [`Matches: ${best.shared.join(', ')}.`] : []),
      ...(stepFree ? ['Step-free route, as you asked.'] : []),
      `${best.free} seats free right now; ${best.sp.redirectHolds.length} ${best.sp.redirectHolds.length === 1 ? 'person is' : 'people are'} being sent there.`,
    ] : [],
    rejected,
    somethingDifferent: pick(different),
    overflow: { title: `Stream of ${from.title}`, room: from.id },
  };
}

module.exports = { redirect };

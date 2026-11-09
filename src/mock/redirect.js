// Mock of the redirect query (P1 builds the Elasticsearch version in src/redirect.js).
// Interests only rank suggestions; they never decide who gets a seat (rule 5).
const HOLD_MS = 10 * 60_000;

function redirect({ db, engine, from, user, now }) {
  // Signed out (the big screen, D1): a read-only suggestion, no hold (issue #23, bug 6).
  const holder = user?.handle || null;
  user = user || { interests: [], needs: [] };
  const interests = new Set(user.interests || []);
  const stepFree = (user.needs || []).some((n) => n === 'step-free' || n === 'wheelchair'); // profile ids, as in src/redirect.js needFlags
  const captions = (user.needs || []).includes('captions');
  const options = [];
  const rejected = [];
  for (const sp of db.spaces.values()) {
    if (sp.type !== 'room' || sp.id === from.id || sp.test) continue; // never send people to a load test room
    sp.redirectHolds = sp.redirectHolds.filter((h) => h.until > now);
    // Rule 3: never send more people than there are free seats. The caller's own hold doesn't count against them.
    // `free` is the same number the tiles show; seats held for others are said separately in words.
    const free = Math.max(0, sp.capacity - engine.taken(sp));
    const held = sp.redirectHolds.filter((h) => h.handle !== holder).length;
    const minutes = engine.walk(from, sp);
    const shared = sp.tags.filter((t) => interests.has(t) || from.tags.includes(t));
    const no = (reason) => rejected.push({ room: sp.id, title: sp.title, reason });
    if (stepFree && !sp.stepFree) { no('Stairs only'); continue; }
    if (free < 1) { no('Full'); continue; }
    if (free - held < 1) { no('No seats left after others were sent there'); continue; }
    options.push({ sp, free, held, minutes, shared, score: shared.length * 10 - minutes + (captions && sp.captions ? 5 : 0) });
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  const different = options.slice(1).sort((a, b) => a.shared.length - b.shared.length || a.minutes - b.minutes)[0];
  for (const o of options.slice(1)) if (o !== different && rejected.length < 4) rejected.push({ room: o.sp.id, title: o.sp.title, reason: `${o.minutes} minutes away, ${o.shared.length ? 'less similar topic' : 'different topic'}` });
  // Signed in: one hold per person. Asking again (a page refresh) keeps the hold they already have in that room, so it
  // neither adds a second place nor runs the hold on forever (issue #23, bug 3). A new best room moves the hold there.
  if (best && holder && !best.sp.redirectHolds.some((h) => h.handle === holder)) {
    for (const sp of db.spaces.values()) if (sp.redirectHolds) sp.redirectHolds = sp.redirectHolds.filter((h) => h.handle !== holder);
    best.sp.redirectHolds.push({ handle: holder, until: now + HOLD_MS });
  }
  const pick = (o) => o && { room: o.sp.id, title: o.sp.title, floor: o.sp.floor, free: o.free, heldForRedirects: o.held, minutes: o.minutes, access: o.sp.access, stepFree: o.sp.stepFree };
  return {
    suggestion: pick(best),
    reasons: best ? [
      ...(best.shared.length ? [`Matches: ${best.shared.join(', ')}.`] : []),
      ...(stepFree ? ['Step-free route, as you asked.'] : []),
      `${best.free} ${best.free === 1 ? 'seat' : 'seats'} free right now${best.held ? `; ${best.held} ${best.held === 1 ? 'person is' : 'people are'} already on their way` : ''}.`,
    ] : [],
    rejected,
    somethingDifferent: pick(different),
    overflow: { title: `Stream of ${from.title}`, room: from.id },
  };
}

module.exports = { redirect };

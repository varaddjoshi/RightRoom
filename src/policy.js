// Organiser time limits (decisions 31, 32, 35). Pure functions: no Elasticsearch calls.
//
// By default nothing is limited. An organiser can set, as an event default (on the venue space's `policy`)
// with an override on any session (the session's `policy`):
//   door_opens_before_min   door window opens this many minutes before the start (unset: no limit)
//   door_closes_after_min   door window closes this many minutes after the start (unset: open until the end)
//   claim_min               an unscanned claim expires after this many minutes and passes on (unset: no limit)
//   claim_access_min        the same for people who stated an access need (unset: same as claim_min)
//   add_walk_time           adds WALK_AVERAGE_MIN to the claim window
// Outside the door window nothing happens for that session: no check-ins, offers or claims.

const MIN = 60 * 1000;
const WALK_AVERAGE_MIN = 10;
const KEYS = ['door_opens_before_min', 'door_closes_after_min', 'claim_min', 'claim_access_min', 'add_walk_time'];

const isSet = (v) => v !== undefined && v !== null && v !== '';

// Session values win over the event's; anything unset in both stays null (no limit).
function effectivePolicy(eventPolicy = {}, sessionPolicy = {}) {
  const out = {};
  for (const k of KEYS) out[k] = isSet(sessionPolicy?.[k]) ? sessionPolicy[k] : isSet(eventPolicy?.[k]) ? eventPolicy[k] : null;
  out.add_walk_time = out.add_walk_time === true;
  return out;
}

// { open, close } as Dates. open null = no earlier limit; close falls back to the session end.
function doorWindow(session, policy) {
  const start = new Date(session.start);
  const open = isSet(policy.door_opens_before_min) ? new Date(start.getTime() - policy.door_opens_before_min * MIN) : null;
  const close = isSet(policy.door_closes_after_min)
    ? new Date(Math.min(start.getTime() + policy.door_closes_after_min * MIN, new Date(session.end).getTime()))
    : new Date(session.end);
  return { open, close, organiser_close: isSet(policy.door_closes_after_min) };
}

// True when check-ins, offers and claims are allowed for this session right now.
function isDoorOpen(session, policy, now = new Date()) {
  const { open, close } = doorWindow(session, policy);
  return (!open || now >= open) && now < close;
}

// Minutes a claim is held before it expires, or null for no limit.
function claimMinutes(policy, { accessNeed = false } = {}) {
  const base = accessNeed && isSet(policy.claim_access_min) ? policy.claim_access_min : policy.claim_min;
  if (!isSet(base)) return null;
  return Number(base) + (policy.add_walk_time ? WALK_AVERAGE_MIN : 0);
}

// When the claim clock starts: the claim time, or the door opening if that is later
// (nobody can scan in before the door opens, so the hold can't run out before then).
function claimClockStart({ claimedAt, session, policy }) {
  const { open } = doorWindow(session, policy);
  return new Date(Math.max(new Date(claimedAt).getTime(), open ? open.getTime() : -Infinity));
}

// When an unscanned claim expires: the earliest of clock start + claim window, the door close and the session end.
function claimDeadline({ claimedAt, session, policy, accessNeed = false }) {
  const limits = [doorWindow(session, policy).close.getTime()];
  const mins = claimMinutes(policy, { accessNeed });
  if (mins !== null) limits.push(claimClockStart({ claimedAt, session, policy }).getTime() + mins * MIN);
  return new Date(Math.min(...limits));
}

module.exports = { WALK_AVERAGE_MIN, KEYS, effectivePolicy, doorWindow, isDoorOpen, claimMinutes, claimClockStart, claimDeadline };

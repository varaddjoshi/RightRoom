# What RightRoom sends to Dash0, and how to read it

Three sources feed Dash0. Nothing here carries a name, a handle or an id: attributes are a few fixed words.

| Source | Service in Dash0 | What it shows |
|---|---|---|
| Server traces (`src/telemetry-env.js`) | `rightroom` | every request through the server, down to Elasticsearch |
| Browser monitoring (`src/rum.js`, off unless `DASH0_BROWSER_TOKEN` is set) | `rightroom-web` | page loads, errors, and the page's own API calls, linked to the server trace |
| Metrics (`src/metrics.js` for SLO 1, `src/slo2.js` for the rest) | `rightroom` | the numbers below |

## The numbers

| Promise or rate | Metric | Attributes | Good / total |
|---|---|---|---|
| **SLO 1.** A live update reaches a phone within 10 seconds | `rightroom.slo1.deliveries` (counter) and `rightroom.slo1.delivery_time` (histogram, ms) | `event.type`, `slo1.within_10s` | good = `slo1.within_10s = true`, total = all, **leave out `event.type = announcement`** |
| **SLO 2.** A person turned away from a full room gets an offer or a redirect within 30 seconds | `rightroom.slo2.responses` (counter) and `rightroom.slo2.time_to_response` (histogram, ms) | `slo2.outcome` = offer, redirect or none; `slo2.within_30s` | good = `slo2.within_30s = true`, total = all |
| **Accessible seats are never lost** | `rightroom.slo2.accessible_seat_misassigned` and `rightroom.slo2.accessible_offers` | none | must stay **0**; show it as "0 of N" |
| **Redirect success rate** | `rightroom.redirects` (counter) | `redirect.followed` | followed = `true`, total = all (settled redirects only) |
| **Staff override rate** | `rightroom.staff.overrides` and `rightroom.room.full_events` | `override.mode` = full, not_full or clear | `not_full` overrides divided by Full events |

## How each number is counted

- **SLO 1** is the server's own clock from publishing an event to the phone saying "I saw it", counted once per signed-in person per event. Known gap: it only counts events a phone confirmed, so an event lost while the live connection reconnects (the platform cuts it every 15 seconds) is invisible until missed events are replayed on reconnect.
- **SLO 2** starts when joining a room's queue leaves a person waiting. The first of an offer or a redirect ends it. If neither comes in 30 seconds it is recorded as a **miss** (`slo2.outcome = none`), so unlike SLO 1 a failure shows up. A person who leaves the queue or checks in before the 30 seconds are up is not a miss.
- **Counted once per person per room.** A person adds at most one SLO 2 outcome per room, and at most one settled redirect per suggested room, so looping join / redirect / leave cannot inflate the numbers. This does not stop someone making many guest accounts; the app has no rate limit.
- **Redirect success** settles when the person checks in at the suggested room within 15 minutes (`true`), or when the 15 minutes run out (`false`). Refreshing the screen does not count as a new redirect.
- **Override rate** needs both counters: a "not full" override by staff, and a room going Full (a real change to Full, not a room that was already Full when the app started).
- **Left out of every number:** the load-test room and stand-in people (handles starting `stand-in`), so the 50-for-5 test and the simulator never look like real misses.

## Where to look in Dash0

- Services: `rightroom` (server) and `rightroom-web` (browser).
- Metrics: everything named `rightroom.*`.
- The check-in rush for the demo: run the simulator rush (`/sim`), then look at the delivery-time and SLO 2 numbers while it runs. The Agent0 finding comes from that real rush; there is nothing to prepare before it.

The SLOs themselves are created in Dash0's screen from the definitions above; this file is the source for what to enter.

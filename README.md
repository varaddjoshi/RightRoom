# RightRoom

One app that puts each talk in the right-size room before a conference, gets people into free seats during it, and learns from real attendance afterwards.

Tracks: Elasticsearch + Dash0 + Merge Forward, Radar optional.

## What it does

- **Before:** Demand forecast from similar past talks in Elasticsearch. Flags mismatches like "80-seat room; similar talks drew about 300", with one-click room swap / overflow plan.
- **During:** Live room status (Full / Filling / Seats free), nearest similar session with seats, and seat release by text with access fit and a short claim window.
- **After:** Check-ins compared with the forecast and saved for the next event.

Access is part of the seat logic, not a filter on top: protected access spaces, step-free routing, clear view of the caption screen, front row kept clear for lip-reading / interpreters, no disclosure, and text-first offers.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Fill in `.env` with your real Elasticsearch and Dash0 values. Never commit `.env`.

`npm start` preloads `src/telemetry-env.js`, which loads `.env` and maps `DASH0_OTLP_ENDPOINT` / `DASH0_TOKEN` to the
`OTEL_EXPORTER_OTLP_*` variables the OpenTelemetry auto-instrumentation reads. Without them, traces are switched off
instead of failing. Real environment variables (for example on the host) override `.env`.

## Run the backend

One Node process serves the pages, the JSON API (`docs/architecture.md`), the live stream (`/api/stream`) and the sweeper that passes on expired offers every 2 seconds. The seat rules run on state in memory (exactly one replica, so two requests never race for a seat). With Elasticsearch configured, that state is saved within about a second of every change and loaded back on start, so a restart or deploy keeps queues, offers, check-ins, accounts and sign-ins.

Needs Node 22.

### Quick start, in memory (no keys)

```bash
npm ci
npm start                       # http://localhost:3000, state resets on restart
```

- Demo users: `dana` (organiser), `leo` (staff), `sam` (attendee, step-free). Password `rightroom-demo`, or `DEMO_PASSWORD`.
- `curl localhost:3000/health` shows `"store":"memory"`.

### With Elasticsearch (state survives restarts)

```bash
cp .env.example .env            # fill in ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY (DASH0_* for traces)
npm start
curl localhost:3000/health      # "store":"elasticsearch"
```

- The state is one document, id `EVENT_ID` (default `cnh-2026`), in index `<ES_INDEX_PREFIX>engine_state` (default `rr_engine_state`). It's saved after changes and once more at shutdown.
- **Try it without touching the demo's state:** `ES_INDEX_PREFIX=rr_test_ npm start`.
- **Start over from the seed:** `RESET_STATE=1 npm start`, or the organiser's reset (`POST /api/sim/reset`).
- If Elasticsearch can't be reached at start, the app runs in memory and saves nothing (`/health` says `"memory (elasticsearch unreachable)"`), so a bad connection never overwrites good saved state.
- This doesn't write the per-entity indexes from `src/es.js` (P1) yet.

### In Docker (the image the cluster runs)

```bash
docker build -t rightroom .
docker run --rm -p 8080:8080 --env-file .env -e PORT=8080 rightroom    # http://localhost:8080
```

### Tests and the load test

```bash
npm test                                                        # seat rules, plus the HTTP load test in-process
node scripts/loadtest.js --url http://localhost:3000            # 50 people try for 5 seats
node scripts/loadtest.js --url http://localhost:3000 --pass-on  # also: an offer passes on after 60s (about a minute)
node scripts/loadtest.js --url https://pantheon.cnh.radarhq.io  # against the cluster
```

The load test signs in as staff (`RR_USER`, default `dana`; `RR_PASSWORD`, default `DEMO_PASSWORD` or `rightroom-demo`). It uses its own test room, never a real one, and removes it afterwards. It passes only if:
- exactly 5 of the 250 claims win, and no offer or person wins twice;
- the room shows 5 of 5 taken;
- a Full status reaches a live stream subscriber.

With `--pass-on`, it also passes only if the unclaimed offer reaches the next person's stream after about 60 seconds. Exit code 0 means every check passed.

### Try the API by hand

```bash
curl -c jar -H 'content-type: application/json' -d '{"handle":"sam","password":"rightroom-demo"}' localhost:3000/api/login
curl -b jar localhost:3000/api/floors                           # rooms by floor, with status
curl -b jar -X POST localhost:3000/api/spaces/310/queue         # queue at a room's door; a free seat is offered at once
curl -b jar localhost:3000/api/spaces/310                       # your offer: id, zone, seconds left
curl -b jar -X POST localhost:3000/api/offers/<offer id>/claim  # claim it within 60 seconds
curl -N -b jar 'localhost:3000/api/stream?space=310'            # live events: status, position, offer, offer_passed
```

### Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` (`8080` in the image) | HTTP port |
| `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY` | unset: in memory | Where the state is saved |
| `ES_INDEX_PREFIX` | `rr_` | Index prefix; use `rr_test_` for experiments |
| `EVENT_ID` | `cnh-2026` | Which saved state to use |
| `RESET_STATE` | unset | `1` starts from the seed and replaces the saved state |
| `DEMO_PASSWORD` | `rightroom-demo` | Password of the demo users. **Set it on the cluster**: the default is public in this repo |
| `SESSION_SECRET` | generated and saved with the state | Signs the login cookie |
| `ORGANISERS`, `STAFF` | `dana`, `leo` | Comma-separated usernames with those roles |
| `DASH0_OTLP_ENDPOINT`, `DASH0_TOKEN` | unset: traces off | Traces to Dash0 (`src/telemetry-env.js`) |

`npm start` loads `.env`, and real environment variables override it.

## Notes

- Scope for the hackathon demo: one event day, about 20 sessions, 6 rooms.
- Past talks come from public talk lists; attendance numbers are seeded, and the demo says so.
- AI coding assistants were used and disclosed, per the hackathon rules.

## Deploy

RightRoom runs on our hackathon cluster `pantheon` at https://pantheon.cnh.radarhq.io. Merging a PR to `main` builds the image and Argo CD deploys it. One-time steps, credentials and limits: [docs/deploy.md](docs/deploy.md).

## Demo data

`scripts/demo.sh [BASE_URL]` stages the demo story from `docs/journey-map.md` ("Example scenarios") on any running RightRoom server (default `http://localhost:3000`; password from `DEMO_PASSWORD`, default `rightroom-demo`). It **resets the server's state first** (as dana, through `/api/sim/reset`), then:

- fills the venue to 179 of 180, so Sam takes the last place and anyone after Sam joins the waitlist;
- leaves Rooms 204 and 305 full with people queued at the door, Room 118 filling with stand-ins being offered seats, 220 filling, and 210, 101 and 310 with room;
- opens Leo's console on the Room 204 door;
- adds Wi-Fi readings (204 back left is weak) and comments on Room 204 alongside the seeded announcements;
- sets Sam's interests and step-free preference but leaves Sam unregistered, so the attendee journey can be walked live.

It prints each room's count, status and queue, plus where to start as Sam, Leo and Dana. Rerun it any time to get back to the same state.

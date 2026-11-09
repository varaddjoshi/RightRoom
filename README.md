# RightRoom

RightRoom makes every "who gets in" decision at a conference visible and fair: the venue door, a session room, a seat. Each space shows its live count, its queue and the rule that decides who gets a place. Each person sees their own position and the reason. Seats are offered, claimed and passed on automatically, and a seat is never given to two people.

Built at the Cloud Native Hackathon, Nov 9, 2026. Tracks: Elasticsearch, Dash0, Merge Forward and Gitar, and Radar (it runs on our team cluster). Live: https://pantheon.cnh.radarhq.io

## What it does

- **Before arriving:** see the venue's live count and the published admission rule, join the waitlist and see your position and the reason.
- **At a room door:** see live whether a room is Full, Filling or has seats free. If it is full, you are sent to the nearest similar session with free seats, matched to your interests, with the walking time and step-free routes if you need them. "Why this?" shows the reasons and the options that were rejected. A redirect never sends more people to a room than it has free seats.
- **Getting a seat:** join the queue from the door; a seat offer reaches your phone with 60 seconds to claim; a missed offer passes to the next person automatically.
- **Inside the room:** check in anonymously; the count updates live for everyone.
- **Door staff and organisers:** a +/- counter and a "room full" switch, one-tap release of empty seats, and a board for rules, capacities and announcements.
- **For everyone:** every status is in words, not only colour; needs are stated as preferences ("step-free"), never a diagnosis; accessibility seats go only to people who need them. No real names are asked for or stored: people use a handle.

The decisions behind this, and who approved each, are in [docs/journey-map.md](docs/journey-map.md); the plan is [docs/project.md](docs/project.md), the design [docs/architecture.md](docs/architecture.md) and [docs/design-system.md](docs/design-system.md).

## What is real and what is stand-in

The app labels its numbers Live, Real or Stand-in, and so do we:

- **Live:** the seat engine and everything people do in it: queues, offers, claims, pass-on, check-ins, room status and live updates. That is running code, not a recording. What you do in the demo is live.
- **Real:** the KubeCon NA 2026 schedule (talks, descriptions, speakers, times, rooms) imported into Elasticsearch from the public Sessionize feed.
- **Stand-in:** room capacities, access seats, walking times, the fill forecast and its history, Wi-Fi readings, comment topics, interest counts, redirect and override rates, and the simulated people in queues and check-ins (`/sim`, `scripts/demo.sh`). Stand-in numbers say so on screen.
- **Not known:** why anyone was waitlisted at this venue this morning. The point is that the reason was never shown.

## How we measure it

- **Dash0 traces** from the server (service `rightroom`).
- **Delivery time (SLO 1, "updates reach phones within 10 seconds"):** screens confirm each live event they show; the server records the time as two Dash0 metrics, `rightroom.slo1.delivery_time` and `rightroom.slo1.deliveries`, counted once per person per event so repeated or forged requests cannot inflate them.
- **Browser monitoring** (service `rightroom-web`) for page loads, errors and API calls, linked to the server traces. It is off unless `DASH0_BROWSER_TOKEN` is set; see [docs/deploy.md](docs/deploy.md).
- **Load test:** 50 people try for 5 seats at once and exactly 5 win. It runs in CI on every PR (`npm test`) and against the live site on demand (see "Tests and the load test").

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

- The state is one document, id `EVENT_ID` (default `cnh-2026`). It's saved after changes and once more at shutdown.
- **Your laptop never touches the demo's state.** Locally the index is your own, `<ES_INDEX_PREFIX>engine_state_local_<your user>` (for example `rr_engine_state_local_raj`). Only the cluster sets `STATE_INDEX=rr_engine_state` (in `deploy/deployment.yaml`), and the whole team shares one Elasticsearch cluster.
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
node scripts/loadtest.js --url https://pantheon.cnh.radarhq.io --live  # the cluster: non-local URLs need --live
```

The load test signs in as staff (`RR_USER`, default `dana`; `RR_PASSWORD`, default `DEMO_PASSWORD` or `rightroom-demo`). It uses its own test room, never a real one, and removes it afterwards. It passes only if:
- exactly 5 of the 250 claims win, and no offer or person wins twice;
- the room shows 5 of 5 taken;
- a Full status reaches a live stream subscriber.

With `--pass-on`, it also passes only if the unclaimed offer reaches the next person's stream after about 60 seconds, and that stream stays open the whole minute. It keeps at most 64 requests in flight (`--concurrency`), which stays under macOS's connection-queue limit. Exit code 0 means every check passed.

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
| `STATE_INDEX` | `<prefix>engine_state_local_<user>` | Index of the saved state. The cluster sets `rr_engine_state` |
| `EVENT_ID` | `cnh-2026` | Which saved state to use |
| `RESET_STATE` | unset | `1` starts from the seed and replaces the saved state |
| `DEMO_PASSWORD` | `rightroom-demo` | Password of the demo users. **Set it on the cluster**: the default is public in this repo |
| `SESSION_SECRET` | generated and saved with the state | Signs the login cookie |
| `ORGANISERS`, `STAFF` | `dana`, `leo` | Comma-separated usernames with those roles |
| `DASH0_OTLP_ENDPOINT`, `DASH0_TOKEN` | unset: traces off | Traces to Dash0 (`src/telemetry-env.js`) |

`npm start` loads `.env`, and real environment variables override it.

## QR codes

Attendees scan printed codes with their phone camera; there is no in-app scanner. Sign in as staff or an organiser and open `/staff/qr` for a printable sheet: one card per space with "I'm at the door" (`/r/:room`), "I'm in the room" (`/r/:room/in`) and "Staff only" (`/staff/room/:room`), plus the venue entrance and the two demo-slide codes for Room 204. Print it from the browser; each space gets its own page.

Each code is also an image at `/qr/:room.svg?kind=door|in|staff` (staff codes need a staff login). Set `PUBLIC_URL` so the codes point at the deployed site, for example `https://pantheon.cnh.radarhq.io`; locally, set it to your LAN address (`http://<your IP>:3000`) so phones on the same Wi-Fi can open them.

## Notes

- Scope for the hackathon demo: one event day. The real KubeCon schedule is imported into Elasticsearch.
- Everyone on the team can explain the architecture ([docs/architecture.md](docs/architecture.md)).
- No personal data, tokens or keys are in the repo or the demo: `.env` is gitignored, and no real names are asked for or stored (people use a handle).

## AI tools we used

Four people built this, each with their own AI coding agent, and we say so openly:

- **Claude Code (Anthropic)** wrote much of the code, tests and docs. Each of us (Hitesh, Revanth, Varad, Raj) ran our own agent; the models were Claude Opus 5.5 and Claude Sonnet 5.5. Commits made with it carry a `Co-Authored-By: Claude ...` trailer: `git log --grep='Co-Authored-By: Claude'` lists them.
- **How we worked with it:** the four of us made the product decisions and approved them; the agents proposed, built and documented them. The agents coordinated through a team chat (SwarmChat), where every plan, decision, change and blocker was posted, so the decisions and who approved each are on record.
- **Gitar (AI code review)** reviewed our pull requests. From 12:56 on Nov 9, `main` changed only through pull requests (one earlier docs commit, `ec13962`, went straight to `main`). Gitar also made one automatic fix commit (`1e66787`, preloading the OpenTelemetry instrumentation). Its review instructions for this project are in [.gitar/review/main.md](.gitar/review/main.md).
- **Radar Cloud's MCP server:** our agents also used it to check the state of our cluster after deploys.

## Rules and what existed before the start

The hackathon rule is that all code is written after 11:00 on Nov 9. We want you to be able to check that, so here is everything in the repo from before 11:00 MST, from `git log --before='2026-11-09 11:00 -0700'` (6 commits, Nov 8 23:08 to Nov 9 00:26):

- a skeleton `README.md` and `env.example` (both since reworked);
- a committed `node_modules` folder (installed third-party packages, not code we wrote; removed from the repo since);
- a 15-line `server.js`: an Express app with a hello page and a `/health` check, and a `package.json` with the dependencies (Express, the Elasticsearch client, OpenTelemetry auto-instrumentation, dotenv). It was a test that the Dash0 and Gitar setup worked; Gitar's one automatic fix to its start script is also in this group;
- `.gitignore` changes.

Every other commit, including the first one with product content (12:04 MST), comes after 11:00. The seat engine, API, screens, Elasticsearch code, the Dash0 telemetry set-up (`src/telemetry-env.js`), deploy and tests were all written after the start. The open question is whether this small scaffold counts as "code written before 11:00"; we list it so the judges can decide.

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

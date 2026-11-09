# RightRoom review instructions

RightRoom decides, in public and in real time, who gets a seat at a live event. The team ships many small PRs under a
hard deadline, so review for what would hurt on stage or in a public repo. **Skip style, naming and formatting nits.**
Report a problem only if it falls under one of the sections below, and say which section. Keep findings short.

## 1. Secrets and personal data (the repo is public)

- Block any token, API key, password, kubeconfig or `.env` content in code, tests, docs, workflows, scripts or PR text.
  Dash0 tokens start with `auth_`.
- `DASH0_BROWSER_TOKEN` is the one token that is meant to reach browsers. It may only come from the environment, never
  from a file in the repo.
- People are random handles. No real names or other personal data stored, logged or sent anywhere. Check-ins are deleted
  after the session. Telemetry must not carry handles, names or free text (no handle as a metric or span attribute; the
  browser SDK's `identify()` is never called).

## 2. The allocation rules that must never break

Source: `docs/architecture.md`, "The rules that must never break". Flag any change in `src/engine.js`,
`src/redirect.js`, `src/store.js` or `src/routes/` that could:

- give one seat to two people (a seat is reserved with a single atomic update on `taken`; a claim changes only the offer,
  with a version check, and only while `held_until` is still in the future);
- let an offer outlive `held_until`, or free a seat without handing it to the next person in the queue;
- redirect more people to a room than it has free seats;
- let interests, handles or arrival tricks decide who gets a seat (interests only rank redirect suggestions; seats go
  first come within accessibility fit);
- give an accessibility seat to someone without that need.

A change to these files should come with a test that fails without it.

## 3. Honesty on screen and in PR text

- Every number shown to people is labelled Live, Real or Stand-in. Flag stand-in or simulated data shown as live or real.
- Flag a PR description or comment that says something was verified, tested or passing when the diff or CI does not show it.

## 4. Accessibility (this is a Merge Forward entry)

For changes under `public/`:

- every status is in words, not only colour or an icon;
- needs are stated as preferences ("step-free"), never as a diagnosis;
- keyboard and screen-reader reachable (labels, roles, focus order), tap targets at least 44px, nothing that needs hover;
- readable at 320px wide (`scripts/mobile-check.sh`).

## 5. Telemetry and SLOs

- Metric and span attributes must be low-cardinality: never a handle, an id or free text.
- Anything that feeds an SLO number (`src/metrics.js`, `POST /api/ack`) must not be inflatable by repeating or forging
  requests: count each event once per signed-in handle.

## 6. Deploy and CI limits

- **One replica only**: live events are held in memory. Flag replicas above 1, an HPA, or a second instance.
- `main` is PR-only. Nothing pushes to `main` or to the `deployed` branch by hand.
- No privileged pods, `hostPath`, `hostNetwork` or `hostPID`. The cluster budget is small.
- Tests and CI must work with no Elasticsearch, Dash0 or other secrets, must use `ES_INDEX_PREFIX=rr_test_`, and must
  never call the live site (`scripts/loadtest.js` refuses a non-local URL without `--live`).
- The whole team shares ONE Elasticsearch cluster. Flag any script that writes, deletes or recreates an index without
  going through `ES_INDEX_PREFIX`.
- Browser scripts load from our own host, not a CDN: the venue's Wi-Fi may block it.

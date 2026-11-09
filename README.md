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

## Notes

- Scope for the hackathon demo: one event day, about 20 sessions, 6 rooms.
- Past talks come from public talk lists; attendance numbers are seeded, and the demo says so.
- AI coding assistants were used and disclosed, per the hackathon rules.

## Deploy

RightRoom runs on our hackathon cluster `pantheon` at https://pantheon.cnh.radarhq.io. Merging a PR to `main` builds the image and Argo CD deploys it. One-time steps, credentials and limits: [docs/deploy.md](docs/deploy.md).

# RightRoom design system: daylight wayfinding

A calm venue app people can trust at a busy door: white cards on a cool grey ground, one highly legible type family, ink-navy actions, and every status written as a word with a drawn shape. Signal yellow marks where you are and urgent notices. The big screen (`/screen/:room`) keeps a dark signage theme for across-the-room reading. Everything lives in `public/rr.css` and `public/app.js` (`window.RR`).

## Where to see it

- `public/design-system.html`: every component working.
- `public/mockups/screen-map.html`: every screen by persona and journey stage, plus the floor view. Example data only.

## Using it

Every page links `/rr.css`, the manifest and app meta tags, and loads `/app.js`. `app.js` injects the app shell: a sticky top bar (brand, "You're at …", user menu with sign out) and the persona tabs, shown as a fixed bottom tab bar on phones and inside the top bar from 960px. Add `class="rr-nonav"` to `<body>` for pages without the shell (login, big screen, the in-room forwarder). The big screen also takes `class="rr-dark"`.

| Persona | Tabs (first tab is Home) |
|---|---|
| Attendee | Now (`/event`), Schedule (`/sessions`), My seat (last room used), Me |
| Door staff | Door (last door, or a door picker at `/sessions?pick=door`), Board (`/sessions`), QR codes, Simulator |
| Organiser | Board (`/staff/setup`), Rooms (`#edit`), Announce (`#ann`), QR codes |

`/` goes to `/event`, which sends staff and organisers on to their Home. After sign in people go back to where they were going (a QR's room) or to their Home.

## Rules

- One primary action per screen (`.rr-btn`, ink navy). Everything else is `.rr-btn--ghost` or sits in a `.rr-more` disclosure. Labels are verbs that say what happens: "Claim my seat", "I'm in the room", "Release 1 seat".
- Fewest taps: no confirm dialogs. Reversible actions use `RR.undo(message, run)` (5 seconds). Successful actions say so with `RR.toast(message)`.
- Status is always `RR.status(st, word)`: a drawn shape (circle, triangle, square) plus a word plus colour. Seats free is blue, so it never depends on telling red from green.
- Every number carries `RR.label('live' | 'real' | 'stand-in' | 'crowd-sourced')`.
- Page header (`.rr-sign`): `h1` title first, the location line (`.rr-eyebrow`, e.g. "255 BC · Floor 2") under it, then state chips. Pages one level deep show a `.back` link. Section headings are real `h2`s; there are no kicker labels above headings.
- Room names come from the data: `RR.roomName(room)` shows the venue's name ("255 BC") and falls back to "Room 204" for numeric ids. Never hard-code room ids, names or floors. Long titles wrap to two lines.
- Lists show `.rr-skel` placeholders while loading, a sentence when empty, and errors through `RR.showError(el, e, retry?)`, which adds a "Try again" button.
- Yellow never carries text on white by itself: yellow fills take ink text and a `--rr-signal-edge` outline; yellow-family text uses `--rr-accent-ink`.
- Focus is a 3px `--rr-focus` ring with a 2px offset on everything focusable. Motion is 120 to 320ms, transform and opacity only, and off under reduced motion.
- No accent stripes on one side of a card, no thick borders on rounded cards, no emoji or glyph icons: icons are the line set in `RR.svg(name)` (now, map, seat, me, door, board, qr, sim, bell, in).

## Tokens

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--rr-bg` | #f4f5f6 | Page ground | |
| `--rr-panel` / `--rr-panel-2` | #ffffff / #eceef1 | Cards / inset rows, inputs | |
| `--rr-ink` | #15181b | Text | 16.3:1 on ground |
| `--rr-muted` | #4d5660 | Secondary text | 6.4:1 or more |
| `--rr-line` | #868f98 | Control borders | 3.0:1 on ground |
| `--rr-hair` | #dde1e5 | Quiet separators only | |
| `--rr-action` / `--rr-on-action` | #1b2a4a / #fff | Primary buttons, selected state | 14:1 |
| `--rr-focus` | #1a5fb4 | Focus ring | 5.8:1 |
| `--rr-signal` / `--rr-signal-edge` / `--rr-accent-ink` | #ffcc00 / #8f6b00 / #7a5600 | You-are-here, urgent; its outline; yellow-family text | edge 4.5:1, text 6.1:1 |
| `--rr-free` / `--rr-on-free` | #1a5fb4 / #fff | Seats free | 6.3:1 |
| `--rr-filling` / `--rr-on-filling` | #e59a00 / #15181b | Filling | 7.6:1 |
| `--rr-full` / `--rr-on-full` | #b8122f / #fff | Full | 6.6:1 |
| `--rr-access` | #5b34b8 | Step-free, accessible seats | 7.3:1 |
| `--rr-font-sign` / `--rr-font-body` | Atkinson Hyperlegible Next | Everything | |
| `--rr-font-code` | Atkinson Hyperlegible Mono | Claim codes | |
| `--rr-t-xs` … `--rr-t-3xl` | 13, 15, 17, 20, 26, 36, 56px | Type scale | |
| `--rr-s1` … `--rr-s7` | 4, 8, 12, 16, 24, 32, 48px | Spacing | |
| `--rr-r1` / `--rr-r2` | 8px / 14px | Small controls / cards and buttons | |
| `--rr-tap` / `--rr-tap-xl` | 56px / 72px | Attendee buttons / staff steppers | |

Why ink navy instead of yellow buttons: yellow on white is 1.5:1, so a yellow button can't separate from the page without an outline, and white-on-yellow text is unreadable. Ink navy gives 14:1 with white text and reads as a trustworthy product; yellow keeps its wayfinding job as the "you are here" and urgent highlight.

## Components

| Class / helper | Used for |
|---|---|
| `RR.nav()` (automatic), `RR.here(text)` | App shell, "You're at …" in the top bar |
| `.rr-screen`, `--wide`, `--split`, `.rr-aside`, `.rr-sign`, `.back` | Page frame, two-column and sticky-header laptop layouts, page header |
| `.rr-btn`, `--ghost`, `--full`, `--plain`, `.rr-btn-stack` | Actions |
| `.rr-status`, `.rr-count`, `.rr-label`, `.rr-position` | State, live counts, data honesty, queue position |
| `.rr-route`, `.rr-why`, `.rr-access` | Redirect suggestion with reasons |
| `.rr-offer`, `.rr-offer__timer`, `.rr-code` | Seat offer (the one authored moment) and claim code |
| `.rr-zones` | 3 × 3 seat picker ("Adjust seat") |
| `.rr-more` | Everything secondary, one tap away |
| `.step`, `.rr-counter`, `.chips` | Steppers and pickers |
| `.rr-announce`, `.notice-badge`, `.rr-dialog` | Announcements and the notice pop-up |
| `.rr-panel`, `.talk`, `.tile`, `.fl-*`, `.slot` | Cards, list rows, floor board, time slots |
| `.rr-skel`, `RR.toast`, `RR.undo`, `RR.showError` | Loading, feedback, undo, errors with retry |

## App install

`public/manifest.webmanifest` (name RightRoom, standalone, theme #1b2a4a, background #f4f5f6, start `/`) and `public/icons/` (SVG, 192, 512, maskable 512, apple-touch-icon) let people add RightRoom to their home screen and open it without browser chrome. Every page carries the manifest link and `apple-mobile-web-app-*` meta tags. No service worker yet.

## Mobile check

`scripts/mobile-check.sh` loads each page in headless Chrome (driven over the DevTools protocol by `scripts/mobile-run.js`, with phone emulation below 1000px) and fails on anything a phone user would hit: the page scrolling sideways, elements off the edge of the screen, tap targets smaller than 44 × 44px, text under 12px, images or inputs wider than their box, and text that a button is painted over. Content inside a sideways-scrolling row (`overflow-x: auto`) may sit past the edge, and links inside a sentence are exempt from the tap-size rule. Full-height screenshots and `details.log` go to `.mobile-shots/` (not committed). Every page and size gets a row; a page that fails to load is a FAIL row, not a crash, and the run ends with "N of M passed".

```sh
scripts/mobile-check.sh public/design-system.html http://localhost:3000/r/204          # phones: 320, 360, 390, 414
scripts/mobile-check.sh --widths 768,1280,1440 http://localhost:3000/staff/setup
scripts/mobile-check.sh --widths 1920x1080 http://localhost:3000/screen/204
```

Screens behind a login: sign in with curl, then pass the session cookie (`rr`) with `--cookie` (or `COOKIE=`):

```sh
curl -s -c /tmp/rr.jar -H 'content-type: application/json' \
  -d '{"handle":"sam","password":"rightroom-demo"}' http://localhost:3000/api/login
scripts/mobile-check.sh --cookie "$(awk '$6=="rr"{print $6"="$7}' /tmp/rr.jar)" http://localhost:3000/r/204/in
```

Sign in as `leo` for S2 and `dana` for S1 the same way.

Which widths each screen must pass:

| Screens | Widths |
|---|---|
| A1 to A7, S2 (attendees and door staff, on phones) | 320, 360, 390, 414 |
| S1 (organisers, on laptops) | 1280 and 1440, plus 768 as a sanity pass |
| D1 (big screen) | 1920x1080 |

Every screen PR runs it at those widths and pastes the pass table into the PR description. It needs Chrome, Chromium or Playwright's headless shell; if none is found it stops and says how to install one (`npx playwright install chromium-headless-shell` is the smallest). Set `CHROME=/path/to/chrome` to pick a specific browser.

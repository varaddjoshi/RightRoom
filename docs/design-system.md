# RightRoom design system: wayfinding signs

The look is venue signage: dark sign panels, signal-yellow actions, condensed capitals for labels, and every status written in words with a shape. Everything lives in `public/rr.css`; open `public/design-system.html` to see each component working.

## Where to see it

- `public/design-system.html`: every component working.
- `public/mockups/screen-map.html`: every screen by persona and journey stage, plus the floor view. Example data only.

## Using it

Add one line to every page:

```html
<link rel="stylesheet" href="/rr.css">
```

Wrap the page content in `<main class="rr-screen">`. Use the classes below and the `--rr-*` tokens; don't write raw hex values or new font sizes in a page.

## Rules

- One primary action per screen, as a yellow `.rr-btn`. Everything else is `.rr-btn--ghost`.
- Buttons are full width and at least 64px tall (`--rr-tap`). Staff counter buttons are 96px (`--rr-tap-xl`). Button labels are verbs that say what happens: "Join the queue", "Claim my seat", "Go to Room 210".
- Status always uses `.rr-status` with `data-status="free|filling|full"`. It shows a shape (● ▲ ■) and a word, so colour is never the only signal. Seats free is blue, not green, so it never depends on telling red from green.
- Live numbers use `.rr-count` (tabular figures). Every number on screen carries a `.rr-label`: `LIVE`, `REAL` or `STAND-IN`.
- Positions say why: `.rr-position` holds the number and the published rule in plain words.
- Access needs use `--rr-access` and the `.rr-access` tag ("♿ Step-free via east lift"). Write them as preferences, never a diagnosis.
- "Why this?" is a native `<details class="rr-why">`, so it works with a keyboard and screen reader without script. Rejected options get `.rr-rejected` and still say why.
- Seat offers use `.rr-offer`. Put `role="alert"` on the short static line ("Seat offer · Room 204") so it is announced once. Keep the ticking seconds out of any live region; announce only 30 seconds, 10 seconds and expiry through a separate `.rr-sr` element with `aria-live="polite"`. Set the bar with the `--rr-left` custom property (`100%` to `0%`).
- The arrow on `.rr-btn` is decorative and left out of the spoken button name.
- The zone grid is nine real buttons with text labels ("Front left"), using `aria-pressed` for the selected zone; `data-access` marks zones with accessible seats.
- Urgent announcements are `.rr-announce[data-urgency="urgent"]` (yellow). Others stay on the panel colour.
- Focus is a 3px yellow ring on every focusable element. Don't remove it.
- Toggle visibility with the `hidden` attribute; `rr.css` makes it win over component display rules.

## Tokens

| Token | Use |
|---|---|
| `--rr-bg` | Page ground |
| `--rr-panel`, `--rr-panel-2` | Sign panels and cards; raised rows, inputs and zone cells |
| `--rr-line` | Outlines and dividers (3:1 or more on every surface) |
| `--rr-ink`, `--rr-muted` | Main text; secondary text and reasons |
| `--rr-signal`, `--rr-on-signal` | Primary action, focus ring, urgent strip; text on yellow |
| `--rr-free`, `--rr-filling`, `--rr-full`, `--rr-on-status` | Status fills; text on any status fill |
| `--rr-access` | Accessibility seats and step-free routes |
| `--rr-font-sign`, `--rr-font-body`, `--rr-font-code` | Barlow Condensed for labels and numbers, Barlow for reading, IBM Plex Mono for claim codes |
| `--rr-t-xs` to `--rr-t-3xl` | Type scale: 13, 15, 17, 22, 30, 44, 72px |
| `--rr-s1` to `--rr-s7` | Spacing: 4, 8, 12, 16, 24, 32, 48px |
| `--rr-r1`, `--rr-r2` | Radius: 2px for signs and chips, 6px for buttons and panels |

Contrast, checked: ink on ground 16.8:1, muted on the darkest panel 6.3:1, text on yellow 12.1:1, text on the status fills 5.9:1 to 10:1, outlines 3:1 or more on every surface.

One theme only, by choice: dark signage reads well on phones at a door and on the big screen.

## Components

| Class | Screens |
|---|---|
| `.rr-screen`, `.rr-sign`, `.rr-eyebrow`, `.rr-panel` | Every screen |
| `.rr-btn`, `.rr-btn--ghost`, `.rr-btn--full`, `.rr-btn--plain`, `.rr-btn-stack` | Every screen |
| `.rr-status`, `.rr-count`, `.rr-label` | A3, A4, A5, S2, D1 |
| `.rr-position` | A3, A5 |
| `.rr-route`, `.rr-why`, `.rr-access` | A5 redirect |
| `.rr-offer`, `.rr-code` | A5 seat offer and claimed state |
| `.rr-zones` | A6 check-in, S2 zone fill |
| `.rr-counter` | S2 count correction for walk-ins who didn't scan |
| `.rr-announce` | A7, S1 |
| `.rr-sr` | Screen-reader-only text anywhere |

## Mobile check

`scripts/mobile-check.sh` renders pages in headless Chrome and fails on anything a phone user would hit: the page scrolling sideways, elements off the edge of the screen, tap targets smaller than 44 × 44px, text under 12px, images or inputs wider than their box, and text covered by a button it doesn't belong to. Content inside a sideways-scrolling row (`overflow-x: auto`) is allowed past the edge. Full-height screenshots go to `.mobile-shots/` (not committed).

```sh
scripts/mobile-check.sh public/login.html http://localhost:3000/r/204      # phones: 320, 360, 390, 414
scripts/mobile-check.sh --widths 768,1280,1440 http://localhost:3000/staff/setup
scripts/mobile-check.sh --widths 1920x1080 http://localhost:3000/screen/204
```

Which widths each screen must pass:

| Screens | Widths |
|---|---|
| A1 to A7, S2 (attendees and door staff, on phones) | 320, 360, 390, 414 |
| S1 (organisers, on laptops) | 1280 and 1440, plus 768 as a sanity pass |
| D1 (big screen) | 1920x1080 |

Every screen PR runs it at those widths and pastes the pass table into the PR description. It needs Chrome or Playwright's headless shell (`npx playwright install chromium-headless-shell`); set `CHROME=/path/to/chrome` to pick one. Pages behind a login show their signed-out state, so check signed-in screens by hand until the end-to-end tests add a login step.

#!/usr/bin/env bash
# Mobile check: renders each page at several widths in headless Chrome, saves full-height
# screenshots to .mobile-shots/ and fails on horizontal overflow, elements off the side of
# the screen, tap targets under 44x44, text under 12px, images/inputs wider than their box,
# or text covered by a button.
#
# Usage:
#   scripts/mobile-check.sh [--widths 320,360,390,414] [--cookie name=value] page.html http://localhost:3000/login ...
#   --widths takes W or WxH entries: 1280,1440 (laptop, height 800) or 1920x1080 (big screen).
#     Phones default to a height of 844 and get mobile emulation; 1000px and wider default to 800.
#   --cookie (or COOKIE=name=value) is set for every http page, so signed-in screens can be checked.
# Override the browser with CHROME=/path/to/chrome.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOTS="$ROOT/.mobile-shots"
WIDTHS="320,360,390,414"
COOKIE="${COOKIE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --widths) WIDTHS="$2"; shift 2 ;;
    --cookie) COOKIE="$2"; shift 2 ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: $0 [--widths 320,360] [--cookie name=value] <page.html|http://url> ..." >&2; exit 2; }

if [ -z "${CHROME:-}" ]; then
  # Newest Playwright headless shell first (globs sort oldest to newest), then installed browsers.
  for c in "$HOME/Library/Caches/ms-playwright"/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
           "$HOME/.cache/ms-playwright"/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell; do
    [ -x "$c" ] && CHROME="$c"
  done
fi
if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "$(command -v google-chrome || true)" "$(command -v chromium || true)" "$(command -v chromium-browser || true)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
if [ -z "${CHROME:-}" ] || [ ! -x "$CHROME" ]; then
  cat >&2 <<'EOF'
No Chrome or Chromium found. Install one, then rerun:
  npx playwright install chromium-headless-shell   (small, recommended)
  brew install --cask google-chrome                (macOS)
  apt-get install chromium                         (Debian/Ubuntu)
or point at a browser binary with CHROME=/path/to/chrome.
EOF
  exit 2
fi
# The headless shell is headless already; every other Chrome needs the flag.
case "$(basename "$CHROME")" in chrome-headless-shell*) HEADLESS="" ;; *) HEADLESS="--headless=new" ;; esac
echo "Browser: $CHROME"

mkdir -p "$SHOTS"
TMP="$(mktemp -d)"
"$CHROME" $HEADLESS --disable-gpu --hide-scrollbars --no-first-run --remote-debugging-port=0 \
  --user-data-dir="$TMP/profile" about:blank >/dev/null 2>&1 &
CPID=$!
trap 'kill $CPID 2>/dev/null; wait $CPID 2>/dev/null; rm -rf "$TMP" 2>/dev/null' EXIT
for _ in $(seq 1 100); do [ -s "$TMP/profile/DevToolsActivePort" ] && break; sleep 0.2; done
[ -s "$TMP/profile/DevToolsActivePort" ] || { echo "FAIL: Chrome did not start ($CHROME)" >&2; exit 2; }
PORT="$(head -1 "$TMP/profile/DevToolsActivePort")"

node "$ROOT/scripts/mobile-run.js" "$PORT" "$SHOTS" "$WIDTHS" "$COOKIE" "$@"

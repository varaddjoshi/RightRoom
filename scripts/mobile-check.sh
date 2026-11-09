#!/usr/bin/env bash
# Mobile check: renders each page at several widths in headless Chrome, saves full-height
# screenshots to .mobile-shots/ and fails on horizontal overflow, elements off the side of
# the screen, tap targets under 44x44, text under 12px, or images/inputs wider than their container.
#
# Usage:
#   scripts/mobile-check.sh [--widths 320,360,390,414] page.html http://localhost:3000/login ...
#   --widths takes W or WxH entries: 1280,1440 (laptop, height 800) or 1920x1080 (big screen).
#   Phones default to a height of 844, anything 1000px or wider to 800.
# Override the browser with CHROME=/path/to/chrome.
# shortcut: pages load without cookies, so screens behind a login show their signed-out
# state; signed-in screens need a hand check until the e2e phase adds a login step.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$ROOT/scripts/mobile-probe.js"
SHOTS="$ROOT/.mobile-shots"
WIDTHS="320,360,390,414"
if [ "${1:-}" = "--widths" ]; then WIDTHS="$2"; shift 2; fi
[ $# -gt 0 ] || { echo "usage: $0 [--widths 320,360] <page.html|http://url> ..." >&2; exit 2; }

# Prefer Playwright's headless shell: full Chrome builds can hang on --dump-dom.
HEADLESS=""
if [ -z "${CHROME:-}" ]; then
  for c in "$HOME/Library/Caches/ms-playwright"/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
           "$HOME/.cache/ms-playwright"/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell; do
    [ -x "$c" ] && CHROME="$c"
  done
fi
if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$(command -v google-chrome || true)" "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && HEADLESS="--headless=new"
  done
fi
[ -n "${CHROME:-}" ] || { echo "No Chrome found; set CHROME=/path/to/chrome (or: npx playwright install chromium-headless-shell)" >&2; exit 2; }

mkdir -p "$SHOTS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

# Runs Chrome with a 30s limit, since a stuck page should fail the check, not hang it.
chrome() {
  "$CHROME" $HEADLESS --disable-gpu --hide-scrollbars --disable-web-security \
    --allow-file-access-from-files --user-data-dir="$TMP/profile" "$@" 2>/dev/null &
  local pid=$! i
  for i in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || { wait "$pid"; return; }; sleep 1; done
  kill "$pid" 2>/dev/null; return 1
}

printf '%-34s %10s  %-8s %4s %4s %4s %4s %5s  %s\n' PAGE SIZE OVERFLOW OFF TAPS TEXT WIDE SPILL RESULT
for page in "$@"; do
  slug="$(echo "$page" | sed -E 's#^https?://##; s#[^A-Za-z0-9]+#-#g; s#^-|-$##g')"
  html="$TMP/$slug.html"
  if [[ "$page" =~ ^https?:// ]]; then
    curl -fsS "$page" > "$html"
    base="$page"
  else
    [ -f "$page" ] || { echo "missing: $page" >&2; fail=1; continue; }
    cp "$page" "$html"
    base="file://$(cd "$(dirname "$page")" && pwd)/"
  fi
  # Resolve the page's relative links against where it really lives, then add the probe.
  perl -0pi -e "s#<head>#<head><base href=\"$base\">#i or s#^#<base href=\"$base\">#" "$html"
  printf '<script>%s</script>\n' "$(cat "$PROBE")" >> "$html"

  for size in ${WIDTHS//,/ }; do
    w="${size%%x*}"
    if [[ "$size" == *x* ]]; then h="${size##*x}"; elif [ "$w" -ge 1000 ]; then h=800; else h=844; fi
    dom="$TMP/$slug-$size.dom"
    if ! chrome --window-size="$w,$h" --virtual-time-budget=3000 --dump-dom "file://$html" > "$dom"; then
      printf '%-34s %10s  %s\n' "${page:0:34}" "${w}x$h" "FAIL (page did not finish loading in 30s)"; fail=1; continue
    fi
    line="$(node -e '
      const fs = require("fs");
      const m = fs.readFileSync(process.argv[1], "utf8").match(/<pre id="mobile-report" hidden="">([\s\S]*?)<\/pre>/);
      if (!m) { console.log("NOREPORT"); process.exit(0); }
      const r = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
      const bad = r.overflow || r.offscreen.length || r.taps.length || r.smallText.length || r.wideMedia.length || r.spill.length;
      console.log([r.height, r.overflow ? "yes" : "no", r.offscreen.length, r.taps.length, r.smallText.length, r.wideMedia.length, r.spill.length, bad ? "FAIL" : "pass"].join(" "));
      if (bad) for (const k of ["offscreen", "taps", "smallText", "wideMedia", "spill"])
        for (const x of r[k].slice(0, 8)) console.error(`    ${k}: ${x}`);
    ' "$dom" 2>"$TMP/detail")"
    if [ "$line" = NOREPORT ]; then
      printf '%-34s %10s  %s\n' "${page:0:34}" "${w}x$h" "FAIL (no report; page script error?)"; fail=1; continue
    fi
    read -r height overflow off taps text wide spill result <<< "$line"
    printf '%-34s %10s  %-8s %4s %4s %4s %4s %5s  %s\n' "${page:0:34}" "${w}x$h" "$overflow" "$off" "$taps" "$text" "$wide" "$spill" "$result"
    [ "$result" = pass ] || { fail=1; cat "$TMP/detail"; }
    shot_h=$(( height < 16000 ? (height > h ? height : h) : 16000 ))
    chrome --window-size="$w,$shot_h" --virtual-time-budget=3000 --screenshot="$SHOTS/$slug-$w.png" "file://$html" >/dev/null || true
  done
done

echo "Screenshots: $SHOTS"
exit $fail

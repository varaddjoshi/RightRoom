#!/usr/bin/env bash
# Stage the demo story (docs/journey-map.md "Example scenarios") on a RightRoom server.
# Usage: scripts/demo.sh [BASE_URL]   (default http://localhost:3000; password from DEMO_PASSWORD)
# It RESETS the server's state first, then adds queues, a waitlist, Leo on the 204 door,
# and fresh Wi-Fi readings and comments. Sam is left untouched for a live walk-through.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PW="${DEMO_PASSWORD:-rightroom-demo}"
JARS="$(mktemp -d)"
trap 'rm -rf "$JARS"' EXIT

# call <jar> <METHOD> <path> [json]: fails loudly with the server's message.
call() {
  local out code
  out="$(curl -sS -b "$JARS/$1" -c "$JARS/$1" -X "$2" -H 'content-type: application/json' \
    ${4:+-d "$4"} -w '\n%{http_code}' "$BASE/api$3")"
  code="${out##*$'\n'}"
  if [ "$code" -ge 400 ]; then echo "FAILED $2 $3 ($code): ${out%$'\n'*}" >&2; exit 1; fi
  printf '%s' "${out%$'\n'*}"
}
login() { call "$1" POST /login "{\"handle\":\"$1\",\"password\":\"$PW\"}" >/dev/null; }

echo "Staging the demo story on $BASE"
login dana; login leo; login sam
call dana POST /sim/reset >/dev/null   # seed: rooms 204 and 305 full, 118/220 filling, 171 of 180 registered, announcements
login dana; login leo; login sam       # reset recreates the demo users, so sign in again

# Venue: 8 more stand-in registrations make it 179 of 180, so Sam gets the last place (as in the scenario)
# and anyone who registers after Sam lands on the waitlist.
WAITLIST=0
for i in $(seq -w 1 8); do
  call "demo-$i" POST /signup "{\"handle\":\"demo-$i\",\"password\":\"$PW\"}" >/dev/null
  case "$(call "demo-$i" POST /event/register)" in *'"waiting"'*) WAITLIST=$((WAITLIST + 1)) ;; esac
done

# Queues at the doors (stand-ins). In rooms with free seats the engine offers them seats at once.
call leo POST /sim/queue '{"space":"204","n":3}' >/dev/null
call leo POST /sim/queue '{"space":"305","n":2}' >/dev/null
call leo POST /sim/queue '{"space":"118","n":6}' >/dev/null

# Leo is on the Room 204 door (after it is full, so no confirm prompt starts).
call leo POST /staff/spaces/204/console '{"action":"open"}' >/dev/null

# Fresh crowd-sourced readings and comments from two checked-in guests (204 back left is weak).
for g in g1 g2; do call "$g" POST /guest >/dev/null; done
call g1 POST /spaces/204/wifi '{"zone":"back-left","mbps":4,"ms":180}' >/dev/null
call g2 POST /spaces/210/wifi '{"zone":"front-centre","mbps":42,"ms":35}' >/dev/null
call g1 POST /spaces/204/comments '{"text":"Slides too small to read from the back rows."}' >/dev/null
call g2 POST /spaces/204/comments '{"text":"Great verifier walkthrough, tracing demo next please."}' >/dev/null

# Sam: interests and step-free preference as in the scenario; not registered, queued or checked in.
call sam PUT /me '{"interests":["kubernetes","observability","ebpf"],"needs":["step-free"]}' >/dev/null

# Summary: the public venue view has no waitlist length, so it is counted above; room queues come from staff views.
EVENT="$(call dana GET /event)"
ROOMS="["; for r in 101 118 204 210 220 305 310; do ROOMS+="$(call dana GET /staff/spaces/$r),"; done; ROOMS="${ROOMS%,}]"
node -e '
const [ev, rooms, wait] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2]), process.argv[3]];
const v = ev.venue;
console.log(`\nVenue: ${v.taken} of ${v.capacity} (${v.status}), ${wait} on the waitlist`);
for (const r of rooms) {
  const q = r.queue || [], w = q.filter((x) => x.status === "waiting").length, o = q.length - w;
  console.log(`Room ${r.id.padEnd(4)} ${String(r.taken).padStart(3)}/${String(r.capacity).padEnd(3)} ${r.status.padEnd(8)} queue ${w} waiting${o ? `, ${o} offered a seat` : ""}${r.staffOn ? `  staff: ${r.staffOn}` : ""}`);
}
' "$EVENT" "$ROOMS" "$WAITLIST"
cat <<EOF

Try this (password: the demo password):
  Sam (phone):    $BASE/login -> /event (register) -> /sessions -> /r/204 (Full: redirect or queue) -> /r/204/in
  Leo (phone):    $BASE/staff/room/204  (release a seat, Sam's offer appears)
  Dana (laptop):  $BASE/staff/setup     (board, forecast, announcements)
  Big screen:     $BASE/screen/204
EOF

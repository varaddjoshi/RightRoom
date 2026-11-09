# RightRoom user journey map

Nov 9, 2026. Built from `docs/project.md` plus Hitesh's additions (sign-in, registration, interests, crowd-sourced Wi-Fi, comment topics). Decisions Q1 to Q22 were agreed in SwarmChat #general.

## Decisions this map rests on

1. The product is called RightRoom. "Doorway" in project.md is old text.
2. There are two personas: Attendee and Event staff. Staff has two modes, organiser and room host, in one console.
3. Access needs are a row in the attendee journey, stated as preferences ("step-free", "near captions").
4. Everyone signs in with GitHub or Google. We store the provider's user ID and a public handle the person picks. Names and emails never appear on a public screen.
5. QR scans at a room ("I'm at the door", "I'm in the room") also work as a one-tap guest, so the demo never stops at a login page.
6. Registering for the event means joining the venue space's queue. The allocation engine gives the result: admitted, waitlisted with a position and reason, or remote only.
7. Talks are not booked in advance. Attendees star talks; stars shape redirects and next-event interest counts. Room seats are first come, within accessibility fit, on the day.
8. Wi-Fi is measured, not read: a 1-second download and latency test when a seated attendee checks in, with consent. Rooms show the median, labelled "Crowd-sourced".
9. Comments attach to a session. Posting needs a check-in to that session, or attendance in the last 24 hours. Topics come from an Elasticsearch `significant_text` aggregation. Room topics run the same aggregation over every session in that room.
10. Organisers see interest counts for planning the next event. Groups under 5 are hidden and nobody's interests are shown per person.
11. Organisers come from an allowlist in `.env`; organisers assign hosts to rooms.
12. Check-ins are deleted after each session. Comments and Wi-Fi readings are kept without the handle. Accounts and interests stay until the user deletes them from their profile.
13. Musts: everything in project.md plus sign-in, registration and interests. Wi-Fi is the first Extra, comments and topics the second.

## Personas

Attendee. Job: "Get into the event and the talks I care about without wasting time at doors, and know why if I can't." Includes judges and the audience during the demo. Some attendees have access needs; see the access row in each stage.

Event staff. Job: "Keep every door honest: the true count, the published rule, and empty seats handed on fast." Organisers set up the event (spaces, capacity, rules, priorities, hosts) and read interest counts afterwards. Room hosts work one door: counter, full switch, seat release, comment moderation.

## Screens

Eleven screens. One screen is one URL; the states listed are what the screen shows in each situation.

| ID | Screen | URL | Who | States |
|---|---|---|---|---|
| A1 | Sign in | `/login` | Attendee, staff | GitHub or Google; "Continue as guest" only when arriving from a room QR |
| A2 | Profile and interests | `/me` | Attendee | First-run handle and interest picker (session tags plus up to 3 free tags); starred talks; delete account |
| A3 | Event home and registration | `/event` | Attendee | Live capacity "162 of 180 in" and the rule; Register; waitlisted "#12, admitted in order of arrival"; admitted; remote only with stream link; public priority list |
| A4 | Schedule | `/sessions` | Attendee | Each talk with room status in words (Full, Filling, Seats free), star, crowd-sourced Wi-Fi median, top comment topics |
| A5 | Room door | `/r/:room` (QR "I'm at the door") | Attendee | Seats free: join queue, position. Full: redirect with walking time, step-free route, "Why this?", rejected options and why, one "something different", overflow room or stream. Seat offer: 60-second claim. Offer missed: passed on, back in queue |
| A6 | In the room | `/r/:room/in` (QR "I'm in the room") | Attendee | Checked in anonymously; Wi-Fi test consent and result; comment box; session topics; after the session: "comment within 24h" |
| A7 | Announcements | `/news` | Attendee | Filtered by floor and urgency, text first, newest on top |
| S1 | Organiser setup | `/staff/setup` | Organiser | Spaces with capacity, rule and public priorities; accessibility seats; assign hosts; post announcement; interest counts for the next event |
| S2 | Host door console | `/staff/room/:room` | Room host | +/− counter (the true total); "room full" switch; release seats (one tap sends offers); queue; accessibility seat status; hide a comment |
| D1 | Big-screen room status | `/screen/:room` | Shared | Live count and status in words, updates as people check in |
| D2 | Check-in simulator | `/sim` | Demo | Button that adds stand-in check-ins and waitlist entries, labelled Stand-in |

Dash0 views (traces, the two SLOs, Agent0, redirect success rate) live in Dash0 and are not built as app screens.

## Attendee journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Before arriving | A1, A2, A3 | Sign in, pick handle and interests, star talks, press Register | "Will I get in, or am I travelling for nothing?" | Unsure | Waitlisted at the door with no reason | Shows position and the rule straight away; texts when admitted or when remote is the only option, before they travel |
| Venue door | A3, A7 | Check status on arrival, read announcements | "Am I in? Did I miss something?" | Anxious, then relieved | Announcements missed or heard late | Live capacity and position; floor-tagged announcements in text |
| Planning the day | A4 | Browse the schedule, see which rooms are filling | "Where is there space right now?" | Curious | No way to see space without walking round | Room status in words on every talk, plus Wi-Fi and topics from people already inside |
| Room door | A5 | Scan "I'm at the door"; join the queue, or take a redirect | "It says full. Is it actually full?" | Frustrated, then reassured | Turned away with nowhere to go | Redirect to a similar talk with free seats, reasons shown, never more people sent than seats |
| Getting a seat | A5 | Phone buzzes with an offer; claim within 60 seconds | "Is this seat really mine?" | Hopeful, then pleased | Empty seats while people wait outside | Seats released by the host go to the queue in order; a missed offer passes on; never double-booked |
| In the room | A6, D1 | Scan "I'm in the room"; agree to the Wi-Fi test; comment | "Is the Wi-Fi this bad for everyone?" | Settled | Nobody knows the room's real count | Anonymous check-in updates the big screen; Wi-Fi reading added to the room median |
| Leaving | A6, A4 | Checked out automatically on the next check-in or at session end; leave a comment within 24h | "Was that worth it? What did others think?" | Reflective | Feedback goes nowhere | Comments become topics on the session and room; starred interests feed the next event |

Access row, stage by stage:

- Before arriving: needs entered as preferences on A2. Any priority is listed publicly on A3.
- Venue door: every status in words, never colour only. Text first for anyone who can't hear announcements.
- Room door: redirects respect step-free routes and "near captions". "Why this?" is in plain language.
- Getting a seat: accessibility seats only go to people who stated that need, and are never lost to the queue. The claim button works with VoiceOver within the 60 seconds.
- In the room: the whole flow passes axe or Lighthouse and a VoiceOver run-through.

Critical moments:

- Aha moment: seeing "#12, admitted in order of arrival" on A3, the reason the venue never gave this morning.
- Moments of truth: the redirect on A5 (do they trust "Why this?" and walk?), and the 60-second claim (does the offer arrive in time, SLO 1).
- Drop-off risks: forced login at a QR scan (fixed by the guest path); an offer that expires unseen; a redirect to a room that is also full (SLO 2, redirect success rate).

## Event staff journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Setup (organiser) | A1, S1 | Sign in via allowlist; set capacity, rule, priorities and accessibility seats per space; assign hosts | "Is the rule clear enough to publish?" | Busy | Rules live in people's heads | The rule is set once and shown to every attendee |
| Doors open (host) | S2 | Run the +/− counter; watch the queue | "How many are really inside?" | Focused | Counts guessed by eye | The counter is the true total; check-ins confirm it |
| Room filling (host) | S2, D1 | Flip "room full" when it is | "Where do I send these people?" | Under pressure | Turning people away with no alternative | Full triggers redirects on A5 automatically |
| Releasing seats (host) | S2 | Spot empty seats, tap release | "Will this cause a scramble?" | Relieved | Seats sit empty | One tap sends offers in queue order, with accessibility seats protected |
| During and after (both) | S1, S2 | Post announcements; hide abusive comments; read interest counts | "What should the next event cover?" | Thoughtful | No data on what people wanted | Topic aggregations and interest counts (groups of 5 or more) |

## Data the new features add

For P1 (indexes) and P2 (API). These sit beside the indexes in project.md.

| Index | Holds |
|---|---|
| users | provider, provider user ID, handle, interest tags, starred sessions, role |
| comments | session, room, text, time, hidden flag (no handle after the session) |
| wifi_readings | room, floor, download speed, latency, time (no handle) |

Registration needs no new index: it is a `queue` entry on the venue space.

## Extras, in cut order

Cut from the top when behind: team finder, forecast, zone map, saved-need alerts, tables, comments and topics, Wi-Fi readings. Wi-Fi and comments are the last Extras to cut.

## Open item

project.md still says "attendees only ever have a random handle" and "data deleted after each session". Decisions 4 and 12 replace both lines; update project.md to match.

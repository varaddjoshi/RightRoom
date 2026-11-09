# RightRoom user journey map

Nov 9, 2026. Built from `docs/project.md` plus Hitesh's additions (sign-in, registration, interests, crowd-sourced Wi-Fi, comment topics, host-confirmed room status, zone map). Decisions Q1 to Q28 were agreed in SwarmChat #general.

## Decisions this map rests on

1. The product is called RightRoom. "Doorway" in project.md is old text.
2. There are two personas: Attendee and Event staff. Staff splits into organiser and room host, who share one console with different tabs.
3. Access needs are a row in the attendee journey, stated as preferences ("step-free", "near captions").
4. Everyone signs in with GitHub or Google. We store the provider's user ID and a public handle the person picks. Names and emails never appear on a public screen.
5. QR scans at a room ("I'm at the door", "I'm in the room") also work as a one-tap guest, so the demo never stops at a login page.
6. Registering for the event means joining the venue space's queue. The allocation engine gives the result: admitted, waitlisted with a position and reason, or remote only.
7. Talks are not booked in advance. Attendees star talks; stars shape redirects and next-event interest counts. Room seats are first come, within accessibility fit, on the day.
8. Wi-Fi is measured, not read: a 1-second download and latency test when a seated attendee checks in, with consent. Rooms and zones show the median, labelled "Crowd-sourced".
9. Comments attach to a session. Posting needs a check-in to that session, or attendance in the last 24 hours. Topics come from an Elasticsearch `significant_text` aggregation. Room topics run the same aggregation over every session in that room.
10. Organisers see interest counts for planning the next event. Groups under 5 are hidden and nobody's interests are shown per person.
11. Organisers come from an allowlist in `.env`; organisers assign hosts to rooms.
12. Check-ins are deleted after each session. Comments and Wi-Fi readings are kept without the handle. Accounts and interests stay until the user deletes them from their profile.
13. Musts: everything in project.md plus sign-in, registration and interests. The zone map and Wi-Fi are the first Extras, built together; comments and topics come next.
14. The app works out room status itself (see "Room status rule"). Filling is pushed straight away. Full is pushed only after the host confirms.
15. If the host doesn't answer within 30 seconds, Full is confirmed automatically. With no host assigned, it is confirmed straight away.
16. Every confirm, "not yet" and auto-confirm is traced to Dash0, giving a third proof number: how often hosts overrode the app.
17. A host can reopen a Full room by releasing seats. Released seats go to the queue as 60-second offers before the room shows "Seats free" to anyone.
18. Hosts can't release seats past the organiser's capacity. Only organisers change capacity.
19. If an offer expires and the queue is empty, the seat returns to "Seats free" for walk-ups.

## Personas

Attendee. Job: "Get into the event and the talks I care about without wasting time at doors, and know why if I can't." Includes judges and the audience during the demo. Some attendees have access needs; see the access row in each stage.

Organiser. Job: "Set fair rules once, before doors open, and learn what to run next time." Works across the whole event, mostly before and after it.

Room host. Job: "Keep my one door honest: the true count, Full only when it's full, and empty seats handed on fast." Works one room, live, during sessions.

### How organisers and hosts differ

| | Organiser | Room host |
|---|---|---|
| Scope | Whole event, every space | One room they were assigned |
| When | Before doors open and after the event | During each session in their room |
| How they get the role | Login on the `.env` allowlist | Assigned by an organiser on S1 |
| Sets | Capacity, admission rule, public priorities, accessibility seats, zones, hosts | Nothing permanent |
| Changes live | Capacity (the only person who can) | The count, Full confirm or "not yet", seat releases |
| Talks to attendees through | Announcements for a floor or the whole event | Seat offers and status of their room |
| Moderates | Nothing by default | Hides comments on sessions in their room |
| Reads afterwards | Interest counts, room and session topics, Dash0 numbers | Their room's override and redirect numbers |
| Screen | S1 Organiser setup | S2 Host door console |

An organiser can open any S2 console and act as a host. A host can't open S1.

## Screens

Eleven screens. One screen is one URL; the states listed are what the screen shows in each situation.

| ID | Screen | URL | Who | States |
|---|---|---|---|---|
| A1 | Sign in | `/login` | Attendee, staff | GitHub or Google; "Continue as guest" only when arriving from a room QR |
| A2 | Profile and interests | `/me` | Attendee | First-run handle and interest picker (session tags plus up to 3 free tags); starred talks; delete account |
| A3 | Event home and registration | `/event` | Attendee | Live capacity "162 of 180 in" and the rule; Register; waitlisted "#12, admitted in order of arrival"; admitted; remote only with stream link; public priority list |
| A4 | Schedule | `/sessions` | Attendee | Each talk with room status in words (Full, Filling, Seats free), star, crowd-sourced Wi-Fi median, top comment topics |
| A5 | Room door | `/r/:room` (QR "I'm at the door") | Attendee | Seats free: join queue, position. Full: redirect with walking time, step-free route, "Why this?", rejected options and why, one "something different", overflow room or stream. Seat offer: zone ("Back, Left") and 60-second claim. Offer missed: passed on, back in queue |
| A6 | In the room | `/r/:room/in` (QR "I'm in the room") | Attendee | Pick zone on a 3×3 grid; checked in anonymously; Wi-Fi test consent and result for the zone; comment box; session topics; after the session: "comment within 24h" |
| A7 | Announcements | `/news` | Attendee | Filtered by floor and urgency, text first, newest on top |
| S1 | Organiser setup | `/staff/setup` | Organiser | Spaces with capacity, rule and public priorities; zones and accessibility seats per room; assign hosts; post announcement; interest counts and topics for the next event |
| S2 | Host door console | `/staff/room/:room` | Room host | +/− counter (the true total); "Room looks full, confirm?" prompt with 30-second countdown; Confirm / "Not yet, N free"; manual Full override; release N seats; queue; 3×3 zone fill; accessibility seat status; hide a comment |
| D1 | Big-screen room status | `/screen/:room` | Shared | Live count, status in words and zone fill, updates as people check in |
| D2 | Check-in simulator | `/sim` | Demo | Button that adds stand-in check-ins and waitlist entries, labelled Stand-in |

Dash0 views (traces, the two SLOs, Agent0, redirect success rate, host override rate) live in Dash0 and are not built as app screens.

## Room status rule

Seats taken = the host counter, or check-ins if they are higher, plus seat offers currently held.

| Status | When | Pushed to phones and D1 |
|---|---|---|
| Seats free | Seats taken is under 80% of capacity | Straight away |
| Filling | 80% or more | Straight away |
| Full | Seats taken reaches capacity, or the host sets it | After the host confirms, after 30 seconds of silence, or straight away with no host |

Without a host counting, the count comes only from check-ins and the status reads "Filling (from check-ins)" rather than Full. Redirects on A5 start only once Full is pushed.

## Attendee journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Before arriving | A1, A2, A3 | Sign in, pick handle and interests, star talks, press Register | "Will I get in, or am I travelling for nothing?" | Unsure | Waitlisted at the door with no reason | Shows position and the rule straight away; texts when admitted or when remote is the only option, before they travel |
| Venue door | A3, A7 | Check status on arrival, read announcements | "Am I in? Did I miss something?" | Anxious, then relieved | Announcements missed or heard late | Live capacity and position; floor-tagged announcements in text |
| Planning the day | A4 | Browse the schedule, see which rooms are filling | "Where is there space right now?" | Curious | No way to see space without walking round | Room status in words on every talk, plus Wi-Fi and topics from people already inside |
| Room door | A5 | Scan "I'm at the door"; join the queue, or take a redirect | "It says full. Is it actually full?" | Frustrated, then reassured | Turned away with nowhere to go | Full is host-confirmed; redirect to a similar talk with free seats, reasons shown, never more people sent than seats |
| Getting a seat | A5 | Phone buzzes with an offer naming the zone; claim within 60 seconds | "Is this seat really mine, and where is it?" | Hopeful, then pleased | Empty seats while people wait outside | Seats released by the host go to the queue in order; a missed offer passes on; never double-booked |
| In the room | A6, D1 | Scan "I'm in the room"; tap their zone; agree to the Wi-Fi test; comment | "Is the Wi-Fi this bad for everyone?" | Settled | Nobody knows the room's real count | Anonymous check-in updates the big screen; Wi-Fi reading added to the zone and room median |
| Leaving | A6, A4 | Checked out automatically on the next check-in or at session end; leave a comment within 24h | "Was that worth it? What did others think?" | Reflective | Feedback goes nowhere | Comments become topics on the session and room; starred interests feed the next event |

Access row, stage by stage:

- Before arriving: needs entered as preferences on A2. Any priority is listed publicly on A3.
- Venue door: every status in words, never colour only. Text first for anyone who can't hear announcements.
- Room door: redirects respect step-free routes and "near captions". "Why this?" is in plain language.
- Getting a seat: accessibility seats only go to people who stated that need, and are never lost to the queue. The claim button works with VoiceOver within the 60 seconds.
- In the room: the zone grid has text labels ("Front, Left") for screen readers. The whole flow passes axe or Lighthouse and a VoiceOver run-through.

Critical moments:

- Aha moment: seeing "#12, admitted in order of arrival" on A3, the reason the venue never gave this morning.
- Moments of truth: the redirect on A5 (do they trust "Why this?" and walk?), and the 60-second claim (does the offer arrive in time, SLO 1).
- Drop-off risks: forced login at a QR scan (fixed by the guest path); an offer that expires unseen; a redirect to a room that is also full (SLO 2, redirect success rate).

## Organiser journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Before the event | A1, S1 | Sign in via allowlist; set capacity, rule and public priorities for the venue and each room; mark zones and accessibility seats | "Is the rule clear enough to publish?" | Busy | Rules live in people's heads | The rule is set once and shown to every attendee on A3 and A5 |
| Staffing | S1 | Assign a host to each room | "Who's covering which door?" | Organised | Hosts improvise | Each host gets one console URL for their room |
| Doors open | S1, A3 | Watch venue registrations and the waitlist; post announcements | "Are people being turned away, and do they know why?" | Watchful | Waitlisting with no reason given | Every waitlisted person sees a position and reason |
| During sessions | S1, S2 | Step into any room console if a host is missing; raise capacity if a bigger room opens | "Is any door stuck?" | Under pressure | No view across rooms | Rooms with no host auto-confirm Full; organisers can take over any S2 |
| After the event | S1 | Read interest counts and room and session topics | "What should the next event cover, and in which rooms?" | Thoughtful | No data on what people wanted | Interest counts (groups of 5 or more), topics, Wi-Fi by zone for venue choice |

## Room host journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Before the session | A1, S2 | Sign in, open their room's console, check the counter is at zero | "Am I set up for the right room?" | Ready | Hosts start without a count | Console opens on their assigned room only |
| Doors open | S2 | Tap +/− as people enter; watch the queue and zone fill | "How many are really inside?" | Focused | Counts guessed by eye | The counter is the true total; check-ins confirm it |
| Room filling | S2 | Get "Room looks full: 50 of 50. Confirm?"; tap Confirm or "Not yet, N free" | "Is it actually full?" | Under pressure | Rooms called full at 47 of 50 | The app suggests, the host decides; silence auto-confirms after 30 seconds |
| Room full | S2, D1 | People at the door get redirects on their phones | "Where do I send these people?" | Relieved | Turning people away with nowhere to go | Redirects on A5 start once Full is pushed |
| Seats free up | S2 | Spot empty seats on the zone grid; release N seats | "Will this cause a scramble?" | In control | Seats sit empty | Offers go to the queue in order, accessibility seats protected, never past capacity |
| During and after | S2 | Hide abusive comments; session ends and check-ins clear | "Anything to clean up?" | Done | Feedback lost | Room topics build from comments; their override and redirect numbers show in Dash0 |

## Data the new features add

For P1 (indexes) and P2 (API). These sit beside the indexes in project.md.

| Index | Holds |
|---|---|
| users | provider, provider user ID, handle, interest tags, starred sessions, role (organiser, host and their room) |
| comments | session, room, text, time, hidden flag (no handle after the session) |
| wifi_readings | room, zone, floor, download speed, latency, time (no handle) |

Existing indexes gain a few fields: `spaces` gets zones and a status-confirmation state, and `checkins` gets a zone. Registration needs no new index: it is a `queue` entry on the venue space.

## Extras, in cut order

Cut from the top when behind: team finder, forecast, saved-need alerts, tables, comments and topics, zone map with Wi-Fi readings. The zone map and Wi-Fi are built together and cut last.

## Open items

project.md is out of date with these decisions. Update it to match:

| project.md says | Replace with | Decision |
|---|---|---|
| "Doorway" in tracks, demo and judge answers | RightRoom | 1 |
| "Attendees only ever have a random handle" and "No real names are stored" | GitHub or Google sign-in storing the provider user ID and a chosen public handle; guest handle for room QR scans | 4, 5 |
| "Data deleted after each session" | Check-ins deleted after each session; comments and Wi-Fi readings kept without the handle; accounts and interests kept until the user deletes them | 12 |
| Personas: attendees and event staff | Attendee, organiser and room host, with different roles and screens | 2 |
| Musts list | Add sign-in, registration (a queue entry on the venue space) and interests | 6, 13 |
| Host "room full" switch | The app suggests Full; the host confirms or says "not yet"; auto-confirm after 30 seconds or straight away with no host; the switch stays as an override | 14, 15 |
| Host releases empty seats | Released seats go to the queue first, never past the organiser's capacity, and return to "Seats free" if the queue is empty | 17, 18, 19 |
| Proof it works (Dash0) | Add the host override rate | 16 |
| Extras: zone map and Wi-Fi separate, Wi-Fi third in the cut order | Zone map and Wi-Fi built together as the first Extra and cut last; comments and topics added as the next Extra | 8, 13 |
| Data model | Add `users`, `comments` and `wifi_readings`; add zones to `spaces` and a zone to `checkins` | Data section above |

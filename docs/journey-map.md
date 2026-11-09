# RightRoom user journey map

Nov 9, 2026. Built from `docs/project.md` plus Hitesh's additions (sign-in, registration, interests, crowd-sourced Wi-Fi, comment topics, automatic room count from check-ins, zone map, door staff instead of room hosts). Decisions Q1 to Q28 were agreed in SwarmChat #general. Q29 to Q33 (door staff) and gaps G1 to G8 are drafts with the recommended answers, awaiting Hitesh.

## Decisions this map rests on

1. The product is called RightRoom. "Doorway" in project.md is old text.
2. There are two personas: Attendee and Event staff. Staff splits into organiser and door staff, who share one console with different tabs.
3. Access needs are a row in the attendee journey, stated as preferences ("step-free", "near captions").
4. Everyone signs in with a username and password; the username is the public handle. Passwords are hashed with scrypt, and no email, name or phone is stored. Roles are attendee, staff and organiser; staff and organiser usernames come from allowlists in `.env`. (revised: password login)
5. QR scans at a room ("I'm at the door", "I'm in the room") also work as a one-tap guest, so the demo never stops at a login page.
6. Registering for the event means joining the venue space's queue. The allocation engine gives the result: admitted, waitlisted with a position and reason, or remote only.
7. Talks are not booked in advance. Attendees star talks; stars shape redirects and next-event interest counts. Room seats are first come, within accessibility fit, on the day.
8. Wi-Fi is measured, not read: a 1-second download and latency test when a seated attendee checks in, with consent. Rooms and zones show the median, labelled "Crowd-sourced".
9. Comments attach to a session. Posting needs a check-in to that session, or attendance in the last 24 hours. Topics come from an Elasticsearch `significant_text` aggregation. Room topics run the same aggregation over every session in that room.
10. Organisers see interest counts for planning the next event. Groups under 5 are hidden and nobody's interests are shown per person.
11. Organisers and door staff come from allowlists in `.env`. Nobody is assigned to a room. (Q29, draft)
12. Check-ins are deleted after each session. Comments and Wi-Fi readings are kept without the handle. Accounts and interests stay until the user deletes them from their profile.
13. Musts: everything in project.md plus sign-in, registration, interests and the "I'm leaving" button (a pending choice in SwarmChat #general, D6: make it an Extra). The zone map and Wi-Fi are the first Extras, built together; comments and topics come next.
14. The count is automatic. Every "I'm in the room" scan adds one person; they drop out when they check in somewhere else, tap "I'm leaving", or the session ends. Nobody has to stand at the door counting. Room status follows from that count (see "Room status rule") and is pushed straight away, including Full. (Q30, revised: automatic count)
15. If a staff member has that room's console open when it reaches capacity, they get "Room looks full, confirm?" and can answer "Not yet, N free" within 30 seconds; with nobody on the console, Full goes out straight away. (Q31, revised: automatic count)
16. Every confirm, "not yet" and auto-confirm is traced to Dash0, giving a third proof number: how often staff overrode the app.
17. Staff can reopen a Full room: they correct the count for people who left without tapping "I'm leaving", then release those seats. Released seats go to the queue as 60-second offers before the room shows "Seats free" to anyone.
18. A release is capped at capacity minus seats taken, so seats already held as offers can't be offered again. Only organisers change capacity.
19. If an offer expires and the queue is empty, the seat returns to "Seats free" for walk-ups.
20. Any staff member opens a room's console by scanning the staff QR at that door. Staff are optional: they run the queue, check claim codes and correct the count, but the count works without them. A Full stays Full until the session ends or a seat is freed by "I'm leaving" or a release. (Q29, revised: automatic count)
21. Attendees get an "I'm leaving" button on A6. It checks them out (the count drops by one) and sends their seat to the queue as an offer straight away, so the seat is never counted twice. (Q32, draft)
22. The +/− counter is an optional correction, not the count: + for people who walked in without scanning, − for people who left without tapping "I'm leaving". Signs at every door say "Scan to count yourself in", and a claimed seat needs the scan within 5 minutes (15 with a stated access need, decision 31), so most people scan. (Q33, revised: automatic count)
23. Updates reach phones through the open page (live updates over server-sent events) plus a browser notification where the person allows it. No SMS, since we store no phone number or email. iPhones only show web notifications from an app added to the home screen, so the open page is the main path. (G1, draft)
24. A venue admission expires 30 minutes after doors open, or 30 minutes after the person is admitted if that is later, unless they scan "I'm at the door" at the venue entrance. The place then goes to the next person on the waitlist, who gets their own 30 minutes. Each `queue` entry stores its own expiry. (G2, draft)
25. Sessions are loaded by a seed script (`scripts/seed.js`) from a JSON file; Elasticsearch builds the session embeddings on load. An S1 schedule import is an Extra that reuses the same loader. (G3, Varad)
26. RightRoom runs one event for the hackathon. Every index carries an `event_id` field so interests can carry over to the next event, but there is no event picker. (G4, draft)
27. A claimed seat shows the handle, zone and a 4-letter code on A5. Door staff see the same code on S2. (G5, draft)
28. Each signed-in user, or each device for guests, holds at most one place per queue. Guest queue joins are rate-limited. (G6, draft)
29. Staff pick a zone when releasing seats. "I'm leaving" uses the zone from that person's check-in. (G7, draft)
30. The venue is a space like any room: its entrance has its own "I'm at the door" QR, staff QR and S2 console. (G8, draft)
31. Claiming a seat is not attending. A claim holds the seat; attendance is the "I'm in the room" scan. After claiming, a person has 5 minutes to scan in, or 15 minutes if they stated an access need; otherwise the seat passes to the next person in the queue. (Varad)
32. Check-in is open from the session's start time until 20 minutes after it. (Varad)
33. Lateness is not recorded: a check-in stores that it happened, not how late it was. (Varad)

## Personas

Attendee. Job: "Get into the event and the talks I care about without wasting time at doors, and know why if I can't." Includes judges and the audience during the demo. Some attendees have access needs; see the access row in each stage.

Organiser. Job: "Set fair rules once, before doors open, and learn what to run next time." Works across the whole event, mostly before and after it.

Door staff. Job: "Wherever I'm needed, make that door honest: the true count, Full only when it's full, and empty seats handed on fast." A volunteer or staff member who walks the floor and steps in at whichever door is busy.

### How organisers and door staff differ

| | Organiser | Door staff |
|---|---|---|
| Scope | Whole event, every space | Whichever room's door they are at |
| When | Before doors open and after the event | During sessions, moving between rooms |
| How they get the role | Login on the organiser allowlist | Login on the staff allowlist; no room assignment |
| Sets | Capacity, admission rule, public priorities, accessibility seats, zones | Nothing permanent |
| Changes live | Capacity (the only person who can) | The count, Full confirm or "not yet", seat releases |
| Talks to attendees through | Announcements for a floor or the whole event | Seat offers and status of the room they are at |
| Moderates | Nothing by default | Hides comments on sessions in the room they are at |
| Reads afterwards | Interest counts, room and session topics, Dash0 numbers | Nothing extra |
| Screen | S1 Organiser setup | S2 Door console |

Organisers are also staff and can open any S2 console. Door staff can't open S1.

## Screens

Eleven screens. One screen is one URL; the states listed are what the screen shows in each situation.

| ID | Screen | URL | Who | States |
|---|---|---|---|---|
| A1 | Sign in | `/login` | Attendee, staff | Username and password; create an account; "Continue as guest" only when arriving from a room QR |
| A2 | Profile and interests | `/me` | Attendee | First-run handle and interest picker (session tags plus up to 3 free tags); starred talks; delete account |
| A3 | Event home and registration | `/event` | Attendee | Live capacity "162 of 180 in" and the rule; Register; waitlisted "#12, admitted in order of arrival"; admitted, with "scan in at the venue door within 30 minutes (of doors opening, or of being admitted if later)"; admission expired; remote only with stream link; public priority list; "Allow notifications" prompt |
| A4 | Schedule | `/sessions` | Attendee | Each talk with room status in words (Full, Filling, Seats free), star, crowd-sourced Wi-Fi median, top comment topics |
| A5 | Room door | `/r/:room` (QR "I'm at the door"; `/r/venue` at the entrance) | Attendee | At the venue: scan in to keep the admission. Seats free: join queue, position. Full: redirect with walking time, step-free route, "Why this?", rejected options and why, one "something different", overflow room or stream. Seat offer: zone ("Back, Left") and 60-second claim. Claimed: handle, zone and a 4-letter code to show at the door. Offer missed: passed on, back in queue |
| A6 | In the room | `/r/:room/in` (QR "I'm in the room") | Attendee | Pick zone on a 3×3 grid; checked in anonymously; Wi-Fi test consent and result for the zone; comment box; session topics; "I'm leaving" button; after the session: "comment within 24h" |
| A7 | Announcements | `/news` | Attendee | Filtered by floor and urgency, text first, newest on top |
| S1 | Organiser setup | `/staff/setup` | Organiser | Import schedule (CSV or JSON); spaces with capacity, rule and public priorities; zones and accessibility seats per room; which rooms have staff at the door right now; post announcement; interest counts and topics for the next event |
| S2 | Door console | `/staff/room/:room` (staff QR at each door) | Door staff, organiser | Live count from check-ins; +/− correction for walk-ins who didn't scan; "Room looks full, confirm?" prompt with 30-second countdown; Confirm / "Not yet, N free"; manual Full override; release N seats in a chosen zone; queue with claim codes; 3×3 zone fill; accessibility seat status; hide a comment; "Leave this door" |
| D1 | Big-screen room status | `/screen/:room` | Shared | Live count, status in words and zone fill, updates as people check in |
| D2 | Check-in simulator | `/sim` | Demo | Button that adds stand-in check-ins and waitlist entries, labelled Stand-in |

Dash0 views (traces, the two SLOs, Agent0, redirect success rate, staff override rate) live in Dash0 and are not built as app screens.

## Room status rule

Seats taken = check-ins, plus any staff correction, plus seat offers currently held. It updates on its own with every scan, "I'm leaving" tap and session end.

| Status | When | Pushed to phones and D1 |
|---|---|---|
| Seats free | Seats taken is under 80% of capacity | Straight away |
| Filling | 80% or more | Straight away |
| Full | Seats taken reaches capacity, or staff set it | Straight away; if staff have the console open, after they confirm or 30 seconds of silence |

Check-ins can only undercount (one handle counts once), so a room that reads Full from check-ins really is full. People who walk in without scanning are the gap: door signs ask everyone to scan, claimed seats need the scan, and staff can add walk-ins with +. Redirects on A5 start only once Full is pushed. "I'm leaving" and staff seat releases both send seats to the queue first, and both lower the count before the offer is added, so a freed seat is never counted twice.

## Attendee journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Before arriving | A1, A2, A3 | Sign in, pick handle and interests, star talks, press Register | "Will I get in, or am I travelling for nothing?" | Unsure | Waitlisted at the door with no reason | Shows position and the rule straight away; updates the open page, with a browser notification where allowed, when admitted or when remote is the only option, before they travel |
| Venue door | A5, A3, A7 | Scan "I'm at the door" at the entrance to keep the admission; read announcements | "Am I in? Did I miss something?" | Anxious, then relieved | Announcements missed or heard late | Live capacity and position; places of no-shows go to the waitlist after 30 minutes; floor-tagged announcements in text |
| Planning the day | A4 | Browse the schedule, see which rooms are filling | "Where is there space right now?" | Curious | No way to see space without walking round | Room status in words on every talk, plus Wi-Fi and topics from people already inside |
| Room door | A5 | Scan "I'm at the door"; join the queue, or take a redirect | "It says full. Is it actually full?" | Frustrated, then reassured | Turned away with nowhere to go | Full comes from the automatic count (check-ins only undercount), with staff able to say "not yet"; redirect to a similar talk with free seats, reasons shown, never more people sent than seats |
| Getting a seat | A5 | Phone buzzes with an offer naming the zone; claim within 60 seconds | "Is this seat really mine, and where is it?" | Hopeful, then pleased | Empty seats while people wait outside | Seats freed by staff or by someone leaving go to the queue in order; a missed offer passes on; never double-booked |
| In the room | A6, D1 | Scan "I'm in the room"; tap their zone; agree to the Wi-Fi test; comment | "Is the Wi-Fi this bad for everyone?" | Settled | Nobody knows the room's real count | Anonymous check-in updates the big screen; Wi-Fi reading added to the zone and room median |
| Leaving | A6, A4 | Tap "I'm leaving", or get checked out on the next check-in or at session end; leave a comment within 24h | "Was that worth it? Can someone have my seat?" | Reflective | Seats sit empty after people leave; feedback goes nowhere | Their seat goes to the next person in the queue; comments become topics; starred interests feed the next event |

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
| Before the event | A1, S1 | Sign in via allowlist; import the schedule; set capacity, rule and public priorities for the venue and each room; mark zones and accessibility seats; print the staff QR for each door, including the venue entrance | "Is the rule clear enough to publish?" | Busy | Rules live in people's heads | The rule is set once and shown to every attendee on A3 and A5 |
| Doors open | S1, A3 | Watch venue registrations and the waitlist; post announcements | "Are people being turned away, and do they know why?" | Watchful | Waitlisting with no reason given | Every waitlisted person sees a position and reason |
| During sessions | S1, S2 | See which filling rooms have no staff at the door and send someone; raise capacity if a bigger room opens | "Which door needs a person?" | Under pressure | No view across rooms | S1 shows rooms that are filling with no console open |
| After the event | S1 | Read interest counts and room and session topics | "What should the next event cover, and in which rooms?" | Thoughtful | No data on what people wanted | Interest counts (groups of 5 or more), topics, Wi-Fi by zone for venue choice |

## Door staff journey

| Stage | Screen | What they do | What they're thinking | Feeling | Pain today | What RightRoom does |
|---|---|---|---|---|---|---|
| Arriving at a door | A1, S2 | Sign in once; scan the staff QR at the door; see the live count already there | "Which room am I covering now?" | Ready | Staff start without a count | The console opens on that room with the count from check-ins |
| Doors open | S2 | Run the queue; tap + only for someone who walks in without scanning | "Is the count right?" | Focused | Counts guessed by eye | The count runs itself from scans; staff only correct it |
| Room filling | S2 | Get "Room looks full: 50 of 50. Confirm?"; tap Confirm or "Not yet, N free" | "Is it actually full?" | Under pressure | Rooms called full at 47 of 50 | The app suggests, staff decide; silence auto-confirms after 30 seconds |
| Room full | S2, D1 | People at the door get redirects on their phones | "Where do I send these people?" | Relieved | Turning people away with nowhere to go | Redirects on A5 start once Full is pushed |
| Seats free up | S2 | Spot empty seats on the zone grid; release N seats in that zone; check claim codes as people arrive | "Will this cause a scramble?" | In control | Seats sit empty | Offers go to the queue in order, accessibility seats protected, never past capacity; "I'm leaving" taps free seats without staff |
| Moving on | S2 | Hide abusive comments; tap "Leave this door" and walk to the next busy room | "Where am I needed next?" | Done here | Nobody knows which doors are covered | The count carries on from check-ins; a Full stays until the session ends or seats are freed; S1 shows it as uncovered |

## Example scenarios

These follow one person from each persona through the same morning. Names, numbers and rooms are made up for illustration.

### Attendee: Sam, who prefers step-free routes

The night before, at 8:10 pm, Sam opens the event link and signs in with GitHub (A1). They pick the handle `blue-otter`, choose Kubernetes and Observability, add the free tag "eBPF", tick "step-free" (A2) and star "eBPF deep dive" in Room 204. On A3 they read "171 of 180 registered. Rule: admitted in order of registration; 6 places held for stated access needs, listed publicly." They press Register and see "Admitted. Scan in at the venue door by 9:30." They allow notifications. Had they registered later, they would have seen "#4 on the waitlist, admitted in order of registration".

At 9:20 Sam scans the QR at the venue entrance, which keeps their admission. An urgent Floor 2 announcement on A7 says the west lift is out of service, so they use the east lift.

At 10:55 the schedule (A4) shows "eBPF deep dive · Room 204 · Filling (96%) · Wi-Fi weak at back left · topics: verifier, tracing".

At 11:05 Sam scans "I'm at the door" at Room 204 (A5). Staff have confirmed the room is Full, so Sam gets a suggestion: "Observability at scale, Room 210, 2 minutes, step-free via the east lift, 9 seats free". "Why this?" says it matches Observability, the route is step-free and seats are free. Room 305 was rejected because it is stairs only, and Room 118 because it is 6 minutes away with a less similar topic. The page also offers a Rust panel as something different, and a stream of Room 204. Sam stays in the 204 queue at #3.

At 11:12 someone at the front taps "I'm leaving". Their seat is an accessible one at Front Left, and Sam stated a step-free need, so the offer goes to Sam ahead of #1 and #2. Sam's phone buzzes: "Seat in Room 204, Front Left (accessible). Claim in 60 seconds." They claim it and get the code `KQ7M`, which the door staff see too.

Inside, Sam scans "I'm in the room" (A6), taps Front Left on the zone grid and allows the Wi-Fi test: 38 Mbps down, 40 ms latency. They comment "Slides too small to read from the back rows." At 11:45 the session ends and Sam is checked out automatically. The check-in is deleted; the comment stays without the handle.

### Door staff: Leo, a volunteer on Floor 2

At 10:50 Leo, already signed in and on the staff allowlist, gets a message from Dana that Room 204 has a queue building and nobody at the door. At 10:52 they scan the staff QR there (S2). The count is already on screen: 46, from check-ins. Two people walk in without scanning, so Leo taps + twice.

At 11:03 the console asks "Room looks full: 50 of 50. Confirm?" Leo can see two empty seats at the back right (two people left without tapping "I'm leaving"), so they tap "Not yet, 2 free", which corrects the count to 48, and pick Back Right. Both seats go to the queue as offers instead of being shown as free to everyone. At 11:04 the prompt returns and Leo confirms. Redirects start for people at the door, and the confirm is traced to Dash0.

At 11:12 the zone grid shows Front Left freed and offered to Sam. Leo doesn't need to do anything; Sam shows `KQ7M` and walks in. At 11:20 Leo hides a spam comment. At 11:25 they tap "Leave this door"; Room 204 goes back to counting check-ins, and Leo walks to Room 118, which S1 lists as filling with nobody at the door.

### Organiser: Dana

The day before, Dana imports the schedule file on S1. They set the venue to 180 places with the rule "order of registration" and 6 places for stated access needs, shown publicly. Room 204 gets 50 seats, 3×3 zones and 4 accessible seats at Front Left. Dana prints a staff QR for every door, including the venue entrance.

On the day, Dana watches registrations and the waitlist from 9:00. Admissions nobody has scanned in for start expiring at 9:30 and go to the waitlist; anyone admitted from the waitlist gets their own 30 minutes. Dana posts the urgent lift announcement for Floor 2. At 10:50 S1 shows "Room 204, Filling 46/50, queue of 6, no staff at the door", so Dana sends Leo to run the queue. They consider raising Room 204's capacity but leave it, because 50 is the fire limit.

After the event, S1 shows interest counts (Observability 52, eBPF 37, "platform eng" 9; anything under 5 is hidden), Room 204's topics ("slides too small", "verifier") and a Wi-Fi median of 4 Mbps at the back left. For the next event Dana plans a bigger room for eBPF, larger screens and another access point at the back. Dash0 shows staff overrode the app's Full suggestion once in 14 prompts.

## Data the new features add

For P1 (indexes) and P2 (API). These sit beside the indexes in project.md.

| Index | Holds |
|---|---|
| users | provider, provider user ID, handle, interest tags, starred sessions, role (attendee, staff, organiser) |
| comments | session, room, text, time, hidden flag (no handle after the session) |
| wifi_readings | room, zone, floor, download speed, latency, time (no handle) |

Existing indexes gain a few fields: `spaces` gets zones, a status-confirmation state and which staff console is open; `checkins` gets a zone; `offers` gets the zone and the 4-letter claim code; `queue` gets the device ID for guests and an admission expiry for the venue. Every index carries `event_id`. Registration needs no new index: it is a `queue` entry on the venue space.

## Extras, in cut order

Cut from the top when behind: team finder, forecast, saved-need alerts, tables, comments and topics, zone map with Wi-Fi readings. The zone map and Wi-Fi are built together and cut last.

## Open items

project.md is out of date with these decisions. Update it to match:

| project.md says | Replace with | Decision |
|---|---|---|
| "Doorway" in tracks, demo and judge answers | RightRoom | 1 |
| "Attendees only ever have a random handle" and "No real names are stored" | GitHub or Google sign-in storing the provider user ID and a chosen public handle; guest handle for room QR scans | 4, 5 |
| "Data deleted after each session" | Check-ins deleted after each session; comments and Wi-Fi readings kept without the handle; accounts and interests kept until the user deletes them | 12 |
| Personas: attendees and event staff (organisers and room hosts) | Attendee, organiser and door staff; no room hosts or room assignment | 2, 11, 20 |
| Musts list | Add sign-in, registration (a queue entry on the venue space), interests and the "I'm leaving" button | 6, 13, 21 |
| Staff "+/− counter at the door" and "room full" switch | The count is automatic from check-ins; +/− is an optional correction; Full is pushed automatically at capacity, with a 30-second confirm only when staff have the console open; the switch stays as an override | 14, 15, 20, 22 |
| Staff release empty seats | Released seats go to the queue first, never past the organiser's capacity, and return to "Seats free" if the queue is empty | 17, 18, 19 |
| Proof it works (Dash0) | Add the staff override rate | 16 |
| Extras: zone map and Wi-Fi separate, Wi-Fi third in the cut order | Zone map and Wi-Fi built together as the first Extra and cut last; comments and topics added as the next Extra | 8, 13 |
| Data model | Add `users`, `comments` and `wifi_readings`; add zones and the open staff console to `spaces`, a zone to `checkins`, zone and claim code to `offers`, and `event_id` everywhere | Data section above, 26 |
| "Get a text-first update when admitted" | Updates on the open page plus a browser notification where allowed; no SMS | 23 |
| Venue admission has no end | Admission expires 30 minutes after doors open unless the person scans in at the venue door | 24, 30 |
| Sessions data owned by P1 with no import path | A seed script loads sessions from JSON; S1 import is an Extra | 25 |
| "Never double-booked" | Also: one queue place per user or device, and a claim code shown at the door | 27, 28 |

Q29 to Q33 and G1 to G8 are drafts. If Hitesh changes an answer, update decisions 11, 14, 15 and 20 to 30 and the rows that cite them.

RightRoom: Final Hackathon Plan
Nov 9, 2026 · @Hitesh
RightRoom makes every "who gets in" decision at an event visible and fair: the venue entrance, a session room, a seat, a table. We enter Elasticsearch, Dash0 and Merge Forward, with Gitar if every PR goes through it, and submit by 5:15 PM.
The idea
The problem, seen at this venue this morning:
People were waitlisted at the door and sent to take part remotely, with no reason given.
There was no way to tell where space was without walking around.
Announcements were missed or heard late.
The same problem at every conference: rooms fill up and people get turned away with nowhere to go. Seats sit empty while people wait outside, because a "full" room often isn't. The APA turned people away from overcrowded sessions; on Cvent's forum a session showed FULL at 47 of 50.
Root cause: the venue's live state is invisible until you're at the door, and the rules that decide who gets a place are hidden.
Main feature: a fair allocation engine. Every scarce space (venue, room, table) has a capacity, a live count, a queue and a published rule. Attendees always see their position and the reason. Seats are offered, claimed and passed on automatically, and never double-booked.
Personas: attendees, organisers (laptop, set rules and capacity) and door staff (phone, any door, no room assignment). See docs/journey-map.md.
What no past winner did: none of the Patch the Conference winners made allocation fair and explainable, used live data, or measured outcomes with SLOs. The closest, Unstuck Live, suggested other sessions when one was full; RightRoom adds published rules, seat offers, no-stampede redirects and proof under load.
Hero feature: getting a place, fairly
About 60% of build time and 2 of the 3 demo minutes go here. Must ships for sure; Extra only if there's time.
Attendee: venue door (before arriving)
Must: see live capacity ("162 of 180 in") and the admission rule
Must: join the waitlist and see my position and reason ("#12, admitted in order of arrival")
Must: any priority, such as access needs, is shown publicly
Must: get an update on the open page (plus a browser notification where allowed; no SMS) when admitted, or when remote is the only option, before travelling
Attendee: room door (during)
Must: see whether a room is Full, Filling or has Seats free, live
Must: if it's full, get sent to the nearest similar session with free seats, matched to my interests, with walking time and step-free routes if needed
Must: see "Why this?" plus the rejected options and why
Must: redirects never send more people than there are seats (no stampede)
Must: one "something different" option, and the overflow room or stream
Attendee: getting a seat
Must: scan "I'm at the door" to join the queue
Must: get a seat offer on my phone with 60 seconds to claim; first come within accessibility fit
Must: if I miss it, it passes to the next person automatically
Must: never double-booked
Attendee: inside the room
Must: scan "I'm in the room" to check in anonymously; the big-screen room status updates live
Must: checked out automatically when I check in elsewhere or the session ends
Event staff (organisers and room hosts)
Must: set capacity and the rule for each space, with any priorities shown publicly
Must: the count is automatic from "I'm in the room" scans; Full goes out at capacity, with a 30-second confirm only when staff have the door console open; +/− is an optional correction and the Full switch an override
Must: release empty seats with one tap, which sends offers to the queue first, never past capacity
Must: see accessibility seat status
Supporting features, accessibility and proof
Supporting features
Must: announcements tagged by floor and urgency, text-first (staff post, attendees read)
Must: username and password sign-in with roles (attendee, staff, organiser); only the chosen public handle is ever shown; guest handle for room QR scans
Must: registration (a place in the venue queue), interests, and an "I'm leaving" button that frees the seat to the queue
Must: check-ins deleted after each session; comments and Wi-Fi readings kept without the handle; accounts and interests kept until the user deletes them
Extra: tables as spaces ("table for 4, floor 2"), reusing the same engine
Extra: zone map inside a room (Front / Middle / Back × Left / Centre / Right), built together with Wi-Fi readings
Extra: saved-need alerts ("tell me when a seat or table matching X frees up")
Extra: crowd-sourced Wi-Fi readings by room and zone (real data, one line in the demo)
Extra: comments turned into session and room topics
Extra: predicted fill risk from similar past talks, with a backtest
Extra: team finder for solo attendees
Built for everyone (Merge Forward)
Must: the whole flow works with a screen reader (axe or Lighthouse, plus a VoiceOver run-through)
Must: every status in words, not just colour
Must: needs stated as preferences ("step-free", "near captions"), never a diagnosis
Must: accessibility seats only go to people who need them
Must: rules and positions explained in plain language, so nobody gets a decision without a reason
Proof it works (Dash0)
Must: every action traced from the phone through to Elasticsearch, with browser monitoring (RUM)
Must: SLO 1 — admission and seat updates reach phones within 10 seconds
Must: SLO 2 — anyone turned away is offered a seat within 30 seconds, and accessibility seats are never lost
Must: redirect success rate: did people go where we sent them?
Must: load test where 50 people try for 5 seats and exactly 5 win
Must: one Agent0 finding from the check-in rush
Must: staff override rate: how often staff said "not yet" to an automatic Full
Must: every number labelled Live, Real or Stand-in
Sponsor tracks
Each tool does a job the product needs. Criteria are from the CNH hackathon page.
Track
How RightRoom uses it
Fit
Elasticsearch
All state lives in one spaces index. One redirect query combines similarity, interests, free seats and distance. Claims use version checks (if_seq_no) and holds expire. Aggregations power the staff dashboard; the percolator powers alerts (extra).
Natural, strong
Dash0
Two SLOs, a judge's own request traced end to end, the audience check-in rush, the Agent0 finding, the redirect success rate
Natural, strong
Merge Forward
Published rules, positions with reasons, protected accessibility seats, step-free redirects, text-first announcements, screen-reader support
Natural; fairness is the core
Gitar
One PR per feature, review rules in .gitar/review/, a CI failure fixed by auto-apply
Process; only if every PR goes through it
Radar
Deploy on the team cluster and investigate a real issue
Optional; only if the starter deploys in under 30 minutes. Don't stage failures for this track

If a judge asks "why Elasticsearch and not Postgres?": our core action is a search — which nearby space matches this person and still has seats right now. That needs vectors, filters and live counts in one query.
Data model (freeze before building)
One engine for venue, rooms and tables: adding a space type costs almost nothing.
Index
Holds
spaces
type (venue, room, table), floor, capacity, live count, rule, accessibility seats, topic embedding (rooms), walking times
queue
handle, space, position, arrival time, priority flag, reason shown, status
offers
space, handle, zone, held_until, claim code, status (Offered, Claimed, Expired, Passed on)
checkins
handle, space, zone, time; deleted after the session
announcements
text, floor, urgency, time
sessions
title, abstract, embedding, room, time

Also: users (handle, password hash, role, interests, needs), comments, wifi_readings; every index carries event_id. No real names or emails are stored: people pick a public handle. Secrets live in a gitignored .env.
Team and build plan
Person
Owns
P1 — Elasticsearch and data
Indexes, redirect query, holds, aggregations, sessions data
P2 — Backend
Rules engine, waitlist, seat release and claim, auto pass-on, check-ins, announcements API, load test
P3 — Frontend and accessibility
Attendee page, room status, redirect with "Why this?", seat offer, host console, axe and VoiceOver
P4 — Infra, observability and demo
Public URL, OpenTelemetry and RUM, Dash0 SLOs and Agent0, Gitar, QR codes, README, recorded backup; Wi-Fi readings only if time allows


Time
Goal
Done when
11:50–12:15
Data model frozen; app at a public URL; first traces in Dash0
A request shows in Dash0
12:15–1:30
Venue waitlist with the published rule; room status from check-ins (automatic count)
"#12, because…" shows; a room flips to Full live
Lunch / panel
If possible, count people into the 2:00 panel room with "I'm in the room" scans for real data
—
2:30–3:30
Redirect ("Why this?", no stampede); seat release and claim with auto pass-on
A full room redirects; a released seat is claimed on a phone
3:30–4:15
Announcements; accessibility pass; first extra (tables) if ahead
axe clean; VoiceOver flow works
4:15–5:00
Proof: 50→5 load test, audience rush, both SLOs, Agent0, README with AI disclosure, recorded backup
Two full runs on phones
5:00–5:15
Submit
15-minute buffer before the 5:30 deadline

Rule for the day: if a Must is at risk at a checkpoint, whoever is on an extra joins that Must's owner.
Demo script (3 minutes)
Time
Say
Show
Track
0:00–0:20
"This morning people were waitlisted at the door with no reason, and none of us could tell where there was space. RightRoom makes every 'who gets in' decision visible and fair."
Title slide
—
0:20–0:50
"Before you leave home, you know where you stand and why."
Waitlisted person sees "#12, admitted in order of arrival"; access priority shown publicly
Merge Forward
0:50–1:30
"Rooms fill. Nobody walks to a full room blind."
Audience scans "I'm in the room"; room flips to Full. A judge at the door is redirected, with "Why this?" and rejected options
Elasticsearch
1:30–2:00
"Empty seats don't stay empty."
Staff release 2 seats; judge's phone buzzes; claim with VoiceOver; a missed offer passes on automatically
Elasticsearch, Merge Forward
2:00–2:40
"And we can prove it works."
The judge's own request in Dash0; both SLOs under the audience rush; the Agent0 finding; 50→5 load test with exactly 5 winners
Dash0
2:40–3:00
"How we built it."
A Gitar-reviewed PR and a CI fix; axe results
Gitar

Use two QR codes on the slides: "I'm in the room" for the audience and "I'm at the door" for judges. Test the public URL on mobile data, and keep a check-in simulator button and a recorded run as fallbacks.
Honesty line (say it): "Audience check-ins are live. Other attendees and waitlist entries are simulated. Venue and session data are real. We don't know why anyone was waitlisted today; the point is that the reason was never shown."
Risks, cut order and judge questions
Cut order if behind: team finder → forecast → saved-need alerts → tables → comments and topics → zone map with Wi-Fi → Radar.
Never cut: published rules with positions, seat-claim correctness, the redirect, both SLOs, screen-reader support.
Risk
Fallback
Phones can't reach the app on venue Wi-Fi
Public URL tested on mobile data; simulator button; recorded run
A seat offered twice
Version check on every claim; wait for the write to show (refresh=wait_for)
Agent0 finds nothing useful
Use a real problem from the day; a staged fault only for the Dash0 beat, never for Radar
Scope creep
Follow the cut order; no extra starts before every Must passes its checkpoint
Name clash
Check "RightRoom" on GitHub and PyPI before submitting

Rules checklist (rules): all code written after 11:00; public repo with setup instructions; AI coding tools disclosed in the README; no personal data, tokens or keys in the repo or demo; everyone can explain the architecture.
Likely judge questions
"Sched and Whova already do capacity and waitlists." They count. We publish the rule, show each person their position and reason, redirect without stampedes, and pass seats on automatically — with SLOs proving it.
"Unstuck Live did alternatives when a session was full." It rerouted after a session was marked full. We cover the venue door and the room door, release seats, prevent stampedes and measure whether redirects worked.
"Why not rank the queue by interest?" Scarce seats go first come within accessibility fit. Interests only shape suggestions, never who gets a seat.
"Is the inclusion just a toggle?" Remove the accessibility rules and the wrong person gets an accessibility seat. Fairness is the product.
Sources
CNH hackathon page and track criteria · CNH rules
Patch the Conference winners · all Patch projects
Unstuck Live repo · CONFUZZ-R repo
APA: reducing overcrowding of popular sessions
Cvent forum: session full when it's not
Sched attendance management · Whova session attendance
re:Invent reserved seating (Classmethod) · Unbound limited-capacity sessions
CNCF Deaf and hard-of-hearing conference best practices
Radar CNH starter


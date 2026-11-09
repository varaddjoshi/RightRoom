// Synthetic event listings (Luma-style details) for /events and /e/:slug. Stand-in data: names, speakers and addresses
// are made up. KubeKon is the live event (store EVENT_ID); its seven "now" sessions are built from ROOMS in seed.js so
// the agenda always matches the live room engine. The meetup is listing-only: agenda and RSVP, no room engine.
// Times are local to each event and match the demo clock (DEMO_CLOCK=2026-11-10T11:45:00-07:00): the live talks run
// Tuesday 11:30 to 12:30.
const { ROOMS } = require('./seed');

const KK = '2026-11-'; // KubeKon days, America/Denver (-07:00 in November)

// Speaker and abstract for each live room's "now" talk; title and tags come from ROOMS.
const LIVE = {
  305: ['mateo', 'intermediate', 'Security', 'Sign every image, record provenance and verify it at admission. A practical path to SLSA level 3 for a small team, with the mistakes we made first.'],
  310: ['hana', 'intro', 'Platform', 'Hands-on: package an app as a chart, add values and tests, and ship it through a registry. Bring a laptop with kind or minikube.'],
  204: ['jonas', 'advanced', 'Observability', 'Attach eBPF programs to kernel and user-space probes to trace latency, syscalls and network flows in production with almost no overhead.'],
  210: ['priya', 'intermediate', 'Observability', 'What changes when you run tracing, metrics and logs for 2,000 services: sampling, cardinality budgets and alerts people trust.'],
  220: ['zoe', 'intro', 'Community', 'Eight five-minute talks from attendees: a kubectl plugin, a cost dashboard, a homelab cluster and more. Sign up at the info desk.'],
  118: ['liam', 'advanced', 'Systems', 'Where Rust in the Linux kernel stands today, what a driver looks like, and how it shares the verifier story with eBPF.'],
  101: ['kwame', 'intro', 'Keynote', 'The keynote hall hosts the midday keynote: how platform teams and app teams split the work, with a live demo of a paved road.'],
};

const EVENTS = [
  {
    slug: 'kubekon-2026',
    eventId: 'cnh-2026', // the live event: capacity, registrations and rooms come from the engine
    name: 'KubeKon 2026',
    tagline: 'Three days of cloud native talks, workshops and a hack day.',
    description: [
      'KubeKon brings platform engineers, SREs and kernel hackers together for three days of talks, hands-on workshops and a hack day. Every room shows live seats on RightRoom, so you can see where there is space before you walk.',
      'Monday is the hack day and opening keynote. Tuesday is the main conference day across seven rooms. Wednesday has deep dives and the closing keynote.',
    ],
    start: `${KK}09T09:00:00-07:00`,
    end: `${KK}11T15:00:00-07:00`,
    timezone: 'America/Denver',
    offset: '-07:00',
    city: 'Salt Lake City',
    venue: { name: 'Wasatch Convention Center, Hall A', address: '100 Example Way, Salt Lake City, UT 84101', mapUrl: 'https://www.openstreetmap.org/search?query=Salt%20Lake%20City%2C%20UT' },
    organiser: 'Cloud Native Hackathon crew',
    hosts: [{ name: 'Dana', role: 'Organiser' }, { name: 'Leo', role: 'Door staff lead' }, { name: 'Zoë Martin', role: 'Community host' }],
    tags: ['kubernetes', 'observability', 'ebpf', 'security', 'platform'],
    cover: 'navy',
    price: 'Free',
    codeOfConduct: 'https://github.com/cncf/foundation/blob/main/code-of-conduct.md',
    accessibility: [
      'Step-free access to every room except Room 305 (stairs only); use the east lift on Floor 2 while the west lift is out.',
      'Live captions in Room 305 all day. Accessible seats at the front left of every step-free room, held for people who state the need.',
      'A quiet room is on Floor 1 next to the info desk.',
    ],
    faq: [
      ['Do I need to register?', 'Yes. Registering puts you in the venue queue; places go in order of registration, and anyone who states an access need is admitted first. You see your place straight away.'],
      ['What happens if a room is full?', 'RightRoom suggests a similar talk with free seats nearby, and you can queue for the next seat. Seats freed by people leaving go to the queue first.'],
      ['Will talks be recorded?', 'Keynotes are streamed and recorded. Room talks are recorded where the speaker agrees.'],
      ['Is there food?', 'Lunch is in the atrium from 12:00 each day. Coffee all day on every floor.'],
    ],
    speakers: {
      kwame: ['Kwame Mensah', 'CTO at a small platform startup. Has run Kubernetes in production since 1.2.'],
      amara: ['Amara Okafor', 'Principal engineer on a platform team; builds internal developer portals.'],
      jonas: ['Jonas Lindqvist', 'Kernel and eBPF engineer working on low-overhead tracing tools.'],
      priya: ['Priya Raman', 'SRE lead who runs observability for 2,000 services.'],
      mateo: ['Mateo García', 'Security engineer focused on supply chain, Sigstore and SLSA.'],
      hana: ['Hana Sato', 'Developer advocate and long-time Helm chart author.'],
      liam: ['Liam O\'Connor', 'Rust systems programmer and Linux kernel contributor.'],
      zoe: ['Zoë Martin', 'Community manager and lightning talk MC.'],
      elena: ['Elena Petrova', 'OpenTelemetry contributor; works on collector pipelines.'],
      dev: ['Dev Malhotra', 'Kubernetes networking engineer; Gateway API and service mesh.'],
      sofia: ['Sofia Rossi', 'Product manager for an internal platform used by 400 developers.'],
      nora: ['Nora Fischer', 'Leads accessibility and inclusive events at a large meetup network.'],
    },
    rooms: Object.fromEntries(ROOMS.map((r) => [r.id, { floor: r.floor }])),
    // [day, start, end, room, title, speaker ids, track, level, tags, abstract]
    sessions: [
      [`${KK}09`, '09:00', '09:45', '101', 'Opening keynote: the state of cloud native', ['kwame'], 'Keynote', 'intro', ['kubernetes', 'platform'], 'Where the ecosystem is heading this year, what changed since last KubeKon, and how the hack day works.'],
      [`${KK}09`, '10:00', '16:00', '220', 'Hack day: build something with RightRoom', ['zoe'], 'Community', 'intro', ['platform'], 'Teams of up to four build on the conference APIs. Mentors in the room all day; demos at 16:00 in the keynote hall.'],
      [`${KK}09`, '10:30', '11:15', '204', 'eBPF from zero', ['jonas'], 'Observability', 'intro', ['ebpf'], 'What an eBPF program is, where it runs, and how to write your first tracepoint with bpftrace in ten lines.'],
      [`${KK}09`, '13:00', '13:45', '210', 'Designing an inclusive conference', ['nora'], 'Community', 'intro', ['community'], 'Captions, quiet rooms, step-free routes and public priority rules: what worked at our last ten events, and what people asked for.'],
      [`${KK}09`, '16:00', '17:00', '101', 'Hack day demos', ['zoe', 'kwame'], 'Community', 'intro', ['platform'], 'Three minutes per team. Prizes for the most useful hack and the best demo.'],

      [`${KK}10`, '09:00', '09:45', '101', 'Keynote: platforms people want to use', ['amara'], 'Keynote', 'intro', ['platform'], 'A platform is a product. How to find out what developers need, ship a paved road, and measure whether it helps.'],
      [`${KK}10`, '10:00', '10:45', '204', 'Tracing TCP retransmits with eBPF', ['jonas'], 'Observability', 'advanced', ['ebpf', 'observability'], 'Find the noisy neighbour: follow retransmits from the socket to the pod with kprobes and ring buffers.'],
      [`${KK}10`, '10:00', '10:45', '210', 'OpenTelemetry collector pipelines that scale', ['elena'], 'Observability', 'intermediate', ['observability'], 'Tail sampling, batching and memory limits: tuning a collector fleet that ingests a million spans a second.'],
      [`${KK}10`, '10:00', '10:45', '220', 'Gateway API in practice', ['dev'], 'Networking', 'intermediate', ['kubernetes'], 'Moving from Ingress to Gateway API without downtime: route by route, with traffic splitting for canaries.'],
      [`${KK}10`, '10:00', '10:45', '305', 'Admission policies that do not break deploys', ['mateo'], 'Security', 'intermediate', ['security', 'kubernetes'], 'Roll out image verification and pod security in audit mode first, then enforce, without paging anyone at 3 am.'],
      [`${KK}10`, '10:00', '10:45', '310', 'Helm chart testing', ['hana'], 'Platform', 'intermediate', ['helm'], 'Unit tests for templates, schema validation for values, and a CI job that installs every chart into kind.'],
      [`${KK}10`, '10:00', '10:45', '118', 'Writing a kernel module in Rust', ['liam'], 'Systems', 'advanced', ['rust'], 'From an empty crate to a loaded module: bindings, safety boundaries and what the build needs.'],
      ...ROOMS.map((r) => [`${KK}10`, '11:30', '12:30', r.id, r.title, [LIVE[r.id][0]], LIVE[r.id][2], LIVE[r.id][1], r.tags, LIVE[r.id][3], true]),
      [`${KK}10`, '14:00', '14:45', '101', 'Panel: who owns the platform?', ['sofia', 'amara', 'kwame'], 'Keynote', 'intro', ['platform'], 'Platform, SRE and app teams on budgets, on-call and saying no. Questions from the floor.'],
      [`${KK}10`, '14:00', '14:45', '204', 'Profiling Go services with eBPF', ['jonas'], 'Observability', 'intermediate', ['ebpf', 'observability'], 'Continuous CPU profiles without a sidecar or code change, and how to read the flame graphs.'],
      [`${KK}10`, '14:00', '14:45', '210', 'SLOs your team will actually use', ['priya'], 'Observability', 'intro', ['observability'], 'Pick two SLOs, wire burn-rate alerts, and retire the dashboards nobody reads.'],
      [`${KK}10`, '14:00', '14:45', '220', 'Lightning talks, round two', ['zoe'], 'Community', 'intro', ['kubernetes'], 'Another eight five-minute talks. Anyone can sign up at the info desk until 13:00.'],
      [`${KK}10`, '14:00', '14:45', '305', 'Secrets without the sprawl', ['mateo'], 'Security', 'intermediate', ['security'], 'External secrets, short-lived credentials and how to find the long-lived keys already in your cluster.'],
      [`${KK}10`, '14:00', '14:45', '310', 'Helm and GitOps together', ['hana'], 'Platform', 'intermediate', ['helm', 'kubernetes'], 'Rendering charts in Argo CD, keeping values in git, and promoting releases between environments.'],
      [`${KK}10`, '14:00', '14:45', '118', 'Memory safety at the kernel boundary', ['liam'], 'Systems', 'advanced', ['rust', 'ebpf'], 'What Rust guarantees inside the kernel, what it cannot, and where unsafe blocks still hide.'],

      [`${KK}11`, '09:30', '10:15', '101', 'Platform engineering metrics that matter', ['sofia'], 'Platform', 'intro', ['platform'], 'Lead time, onboarding time and developer satisfaction: which ones moved when we shipped our platform.'],
      [`${KK}11`, '10:30', '11:15', '204', 'eBPF security monitoring', ['jonas', 'mateo'], 'Security', 'advanced', ['ebpf', 'security'], 'Detect container escapes and unexpected execs with eBPF, and keep the alert volume sane.'],
      [`${KK}11`, '10:30', '12:00', '310', 'Workshop: build an internal developer portal', ['amara'], 'Platform', 'intermediate', ['platform', 'kubernetes'], 'Ninety minutes, hands-on: a service catalogue, a template that creates a repo and a deploy, and docs in one place.'],
      [`${KK}11`, '13:30', '14:30', '101', 'Closing keynote and hack day awards', ['kwame', 'zoe'], 'Keynote', 'intro', ['kubernetes'], 'What we learned from three days of live room data, and the hack day winners.'],
    ],
  },
  {
    slug: 'cn-portland-dec-2026',
    name: 'Cloud Native Portland: eBPF and Observability Night',
    tagline: 'An evening of two talks, lightning talks and pizza.',
    description: [
      'Our December meetup is all about seeing inside your systems. Two talks on eBPF and OpenTelemetry, then open lightning talks and time to meet people.',
      'Everyone is welcome, whether you run clusters for a living or are just curious. Food and drinks, including non-alcoholic options, are provided.',
    ],
    start: '2026-12-03T17:30:00-08:00',
    end: '2026-12-03T21:00:00-08:00',
    timezone: 'America/Los_Angeles',
    offset: '-08:00',
    city: 'Portland',
    venue: { name: 'The Foundry Loft', address: '412 NW Example Ave, Portland, OR 97209', mapUrl: 'https://www.openstreetmap.org/search?query=Portland%2C%20OR' },
    organiser: 'Cloud Native Portland',
    hosts: [{ name: 'Rita Alvarez', role: 'Organiser' }, { name: 'Kenji Watanabe', role: 'Co-host' }],
    tags: ['ebpf', 'observability', 'meetup'],
    cover: 'violet',
    price: 'Free',
    capacity: 80,
    rule: 'First 80 RSVPs get a place; after that you join the waitlist in order and move up when someone cancels.',
    codeOfConduct: 'https://github.com/cncf/foundation/blob/main/code-of-conduct.md',
    accessibility: [
      'Step-free entrance from NW Example Ave and a lift to the loft.',
      'Talks are captioned live on the side screen.',
      'All-gender restrooms on the same floor.',
    ],
    faq: [
      ['Is it free?', 'Yes. RSVP so we order enough food and the building lets you in.'],
      ['Can I give a lightning talk?', 'Yes, five minutes on anything cloud native. Add your name on the board when you arrive.'],
      ['Will it be recorded?', 'The two main talks are recorded and posted a week later. Lightning talks are not.'],
      ['I cannot come any more.', 'Cancel your RSVP on this page so the next person on the waitlist gets your place.'],
    ],
    speakers: {
      rita: ['Rita Alvarez', 'Organiser of Cloud Native Portland; platform engineer.'],
      tomas: ['Tomás Silva', 'Performance engineer who uses eBPF to find latency in Java services.'],
      kenji: ['Kenji Watanabe', 'Runs the observability stack at a Portland retailer; OpenTelemetry user since 0.x.'],
    },
    rooms: { loft: { name: 'The Loft', floor: 2 } },
    sessions: [
      ['2026-12-03', '17:30', '18:00', 'loft', 'Doors open, pizza and hellos', ['rita'], 'Community', 'intro', ['meetup'], 'Grab food, find a seat and meet the people next to you.'],
      ['2026-12-03', '18:00', '18:40', 'loft', 'Finding JVM latency with eBPF', ['tomas'], 'Observability', 'intermediate', ['ebpf'], 'Off-CPU analysis and lock contention in a Java service, found with eBPF and fixed in one line.'],
      ['2026-12-03', '18:45', '19:25', 'loft', 'OpenTelemetry on a budget', ['kenji'], 'Observability', 'intro', ['observability'], 'How a small team kept tracing costs flat while traffic tripled: sampling, retention and what we stopped collecting.'],
      ['2026-12-03', '19:30', '20:15', 'loft', 'Open lightning talks', ['rita'], 'Community', 'intro', ['meetup'], 'Five minutes each, sign up on the board. Slides optional.'],
      ['2026-12-03', '20:15', '21:00', 'loft', 'Networking', [], 'Community', 'intro', ['meetup'], 'Stay and talk. We close the doors at 21:00.'],
    ],
  },
];

// Turns the compact rows above into session objects with times as ISO strings in the event's offset.
function build(ev) {
  const sessions = ev.sessions.map(([day, from, to, room, title, who, track, level, tags, abstract, live], i) => ({
    id: `${ev.slug}-${i + 1}`,
    start: `${day}T${from}:00${ev.offset}`,
    end: `${day}T${to}:00${ev.offset}`,
    room,
    roomName: ev.rooms[room]?.name || null, // null: the page names numbered rooms itself (RR.roomName)
    floor: ev.rooms[room]?.floor ?? null,
    title, track, level, tags, abstract,
    speakers: who.map((s) => ({ name: ev.speakers[s][0], bio: ev.speakers[s][1] })),
    live: !!live, // the live room engine's current talk in this room
  })).sort((a, b) => a.start.localeCompare(b.start) || a.room.localeCompare(b.room));
  const { sessions: _, speakers, offset, ...rest } = ev;
  return { ...rest, sessions, speakers: Object.values(speakers).map(([name, bio]) => ({ name, bio })) };
}

const LIST = EVENTS.map(build);
const bySlug = (slug) => LIST.find((e) => e.slug === slug) || null;

module.exports = { EVENTS: LIST, bySlug };

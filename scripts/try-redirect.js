// Prints the redirect for a room, for checking P1 by hand.
//   node scripts/try-redirect.js r204 [--group 2] [--needs step_free,captions] [--interests observability,ebpf] [--at 2026-11-10T11:45:00-07:00] [--json]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { redirect } = require('../src/redirect');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

async function main() {
  const spaceId = process.argv[2];
  if (!spaceId || spaceId.startsWith('--')) throw new Error('usage: try-redirect.js <spaceId> [--group N] [--needs a,b] [--interests a,b] [--json]');
  const now = arg('at') ? new Date(arg('at')) : new Date();
  const r = await redirect({ spaceId, groupSize: Number(arg('group') || 1), needs: list(arg('needs')), interests: list(arg('interests')), now });
  if (process.argv.includes('--json')) return console.log(JSON.stringify(r, null, 2));

  console.log(`From ${r.from.name} (${r.from.status}, ${r.from.free} free), session: ${r.current_session?.title || 'none'}; match: ${r.match_method}`);
  const show = (label, e) => e && console.log(`${label}: ${e.space_name} - ${e.title}\n    ${e.reasons.join(' | ')}`);
  show('Suggestion', r.suggestion);
  r.alternatives.forEach((a) => show('Also', a));
  show('Different', r.something_different);
  for (const x of r.rejected) console.log(`Not ${x.space_name}: ${x.reason}`);
  if (r.overflow) console.log(`Overflow: ${r.overflow.space_name || '-'} (${r.overflow.free ?? '?'} free), stream ${r.overflow.stream_url || '-'}`);
}

main().catch((e) => {
  console.error('Redirect failed:', e?.meta?.body?.error?.reason || e.message);
  process.exit(1);
});

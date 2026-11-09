// Significant terms in one session's comments against all comments.
// shortcut: in-memory stand-in for Elasticsearch significant_text; P1's aggregation replaces it.

const STOP = new Set('a an the and or but to of in on at for from with is are was were be been it its this that these those i we you they he she my our your their me us them so very too just not no can could would should will do does did have has had as by about than then there here what when how why who which more most some any all also really much'.split(' '));

// n-grams of 1 to 3 words that don't start or end with a stopword
function terms(text) {
  const w = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const out = new Set();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some(x => x.length < 3 && !STOP.has(x))) continue;
      out.add(g.join(' '));
    }
  }
  return out;
}

function docFreq(texts) {
  const df = new Map();
  for (const t of texts) for (const term of terms(t)) df.set(term, (df.get(term) || 0) + 1);
  return df;
}

// JLH-style score, like significant_text's default
function topTerms(comments, background, size = 5) {
  const fg = docFreq(comments), bg = docFreq(background);
  const nF = comments.length || 1, nB = background.length || 1;
  const scored = [...fg]
    .filter(([, c]) => c >= 2)
    .map(([term, c]) => {
      const fp = c / nF, bp = (bg.get(term) || c) / nB;
      return { term, count: c, score: (fp - bp) * (fp / bp) };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.term.split(' ').length - a.term.split(' ').length || a.term.localeCompare(b.term));
  // drop a term already covered by a longer kept term with the same count ("slides" inside "slides too small")
  const kept = [];
  for (const s of scored) {
    if (kept.some(k => k.count === s.count && k.term.includes(s.term))) continue;
    kept.push(s);
    if (kept.length === size) break;
  }
  return kept.map(({ term, count }) => ({ term, count }));
}

module.exports = { topTerms };

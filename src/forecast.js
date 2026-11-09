// Fill forecast from similar past talks. Pure functions; every prediction carries its reasons.

const K = 5;

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (new Set([...A, ...B]).size || 1);
}

// 0 = identical talk, larger = less alike
function distance(s, h) {
  return (1 - jaccard(s.tags, h.tags)) * 0.6
    + (s.slot === h.slot ? 0 : 0.15)
    + Math.abs(Math.log(s.capacity / h.capacity)) * 0.2
    + (!!s.keynoteAdjacent === !!h.keynoteAdjacent ? 0 : 0.05);
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function predictFill(session, history) {
  const near = history
    .map(h => ({ h, d: distance(session, h) }))
    .sort((a, b) => a.d - b.d || a.h.id.localeCompare(b.h.id))
    .slice(0, K);
  const w = near.map(n => 1 / (n.d + 0.05));
  const total = w.reduce((a, b) => a + b, 0);
  const fill = near.reduce((a, n, i) => a + w[i] * (n.h.attendance / n.h.capacity), 0) / total;
  const pFull = near.reduce((a, n, i) => a + w[i] * (n.h.fullMinute != null ? 1 : 0), 0) / total;
  const round2 = x => Math.round(x * 100) / 100;
  return {
    expectedFill: round2(fill),
    probabilityFull: round2(pFull),
    likelyFullMinute: median(near.filter(n => n.h.fullMinute != null).map(n => n.h.fullMinute)),
    risk: pFull >= 0.6 ? 'high' : pFull >= 0.3 ? 'medium' : 'low',
    because: near.slice(0, 3).map(n => ({
      title: n.h.title,
      capacity: n.h.capacity,
      attendance: n.h.attendance,
      fullMinute: n.h.fullMinute,
      similarity: round2(1 / (1 + n.d)),
    })),
    source: 'stand-in',
  };
}

// Leave-one-out: predict each past talk from all the others.
function backtest(history) {
  const rows = history.map(h => {
    const p = predictFill(h, history.filter(x => x !== h));
    const actualFill = h.attendance / h.capacity;
    return {
      title: h.title,
      predictedFill: p.expectedFill,
      actualFill: Math.round(actualFill * 100) / 100,
      predictedFull: p.probabilityFull >= 0.5,
      actualFull: h.fullMinute != null,
    };
  });
  const accuracy = rows.filter(r => r.predictedFull === r.actualFull).length / rows.length;
  const mae = rows.reduce((a, r) => a + Math.abs(r.predictedFill - r.actualFill), 0) / rows.length;
  return { talks: rows.length, accuracy: Math.round(accuracy * 100) / 100, meanAbsError: Math.round(mae * 100) / 100, rows, source: 'stand-in' };
}

module.exports = { predictFill, backtest, jaccard };

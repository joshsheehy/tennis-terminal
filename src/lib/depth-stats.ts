// Small statistics helpers for the depth validator. Kept separate from the
// route and unit-tested, because these functions produce the numbers that
// decide whether the feature ships at all.

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Fractional ranks, ties averaged — required for Spearman to be correct when
 * depth ties (which it does whenever two events sit alone at their level). */
export function rankAverage(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = r;
    i = j + 1;
  }
  return ranks;
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}

export function spearman(xs: number[], ys: number[]): number {
  return pearson(rankAverage(xs), rankAverage(ys));
}

/** Ordinary least squares through the origin: y ~ b*x. Used to fit the Δdepth
 * correction, where b must be 0 when Δdepth is 0 by construction. */
export function olsThroughOrigin(xs: number[], ys: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += xs[i] * ys[i];
    den += xs[i] * xs[i];
  }
  return den === 0 ? 0 : num / den;
}

export function mae(errors: number[]): number {
  if (errors.length === 0) return NaN;
  return mean(errors.map(Math.abs));
}

/** Share of adjacent pairs ordered the same way in both sequences. Reported
 * alongside exact-order match because exact match is brutally strict for
 * clusters of more than three events. */
export function concordantPairs(xs: number[], ys: number[]): { agree: number; total: number } {
  let agree = 0;
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const a = Math.sign(xs[i] - xs[j]);
      const b = Math.sign(ys[i] - ys[j]);
      if (a === 0 || b === 0) continue;
      total++;
      if (a === b) agree++;
    }
  }
  return { agree, total };
}

export function round(x: number, places = 3): number | null {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

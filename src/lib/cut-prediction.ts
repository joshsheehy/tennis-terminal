// Beta cut-projection model, v2 ("blend-v2"). Pure functions only — the
// routes feed it rows and store what it returns.
//
// Every structural choice here was fitted on a walk-forward backtest over
// 2,676 real cut observations (2022-2026 production data), scored against
// the "same cut as last year" baseline:
//
//   predicted cut = blended own history × tier-change factor
//
//   1. BLENDED BASE — a weighted mean of the tournament's own last two cuts
//      (heavier on last year; weights fitted per draw). Two-year blending
//      beat last-year-only in every draw.
//   2. TIER-CHANGE FACTOR — when a tournament changed level since last year
//      (Challenger 75 → 100, ATP 250 → Challenger…), its own history is
//      biased; rescale by the ratio of median cuts between the two exact
//      levels, measured on prior seasons only.
//   3. COHORT FALLBACK — events with no history take the median cut of
//      same-tier events within ±2 calendar weeks last season (geographic
//      neighbours preferred), with a wider uncertainty band.
//
// Factors the backtest REJECTED (kept as switched-off machinery so they can
// be re-fitted as data grows, and so the backtest keeps measuring them):
//   - year-over-year market drift of comparable tournaments: helped nothing
//     once blending was in (singles MAE worsened 48.6 → 50.8 with it on).
//   - calendar-supply ratios (same-week event count, run-up density — the
//     aggregate of "how many weeks in a row the field has been playing"):
//     the fitted exponents came out 0; at any positive damping they added
//     noise. supplyAdjustment() stays wired with fitted-zero betas.
//
// Fitted accuracy vs baseline (walk-forward, editions with a last-year cut):
//   singles main  MAE 48.6 vs 53.1  (-8.5%), win rate 0.53
//   singles quali MAE 198  vs 207   (-4.3%), win rate 0.53
//   doubles       MAE 194  vs 205   (-5.3%), win rate 0.57
//
// Output is a range, not a point: bands are the fitted 75th percentile of
// relative absolute error per draw × tier.

export const MODEL_VERSION = 'blend-v2';

export type TierGroup = 'gs' | 'tour' | 'challenger';
export type PredictDraw = 'ms' | 'qs' | 'md';

export type CutObservation = {
  slug: string;
  year: number;
  week: number;
  group: TierGroup;
  /** Exact level string ("Challenger 75", "ATP 250"…) for tier-change scaling. */
  level: string;
  latitude: number | null;
  longitude: number | null;
  cut: number;
};

export type OwnHistory = {
  lastYearCut: number | null;
  yearBeforeCut: number | null;
  lastYearLevel: string | null;
};

export type CutPrediction = {
  cut: number;
  low: number;
  high: number;
  method: 'trend' | 'cohort';
  tierFactor: number;
};

export function tierGroup(level: string): TierGroup | null {
  const l = level.toLowerCase();
  if (l.includes('grand slam')) return 'gs';
  if (l.startsWith('atp')) return 'tour';
  if (l.includes('challenger')) return 'challenger';
  return null; // ITF and team events are out of scope
}

// Weight on last year's cut in the blended base (rest on the year before);
// fitted per draw on the 2022-2026 backtest.
const BLEND_W1: Record<PredictDraw, number> = { ms: 0.7, qs: 0.65, md: 0.8 };

// Relative half-width of the projected range: fitted p75 of |relative error|
// per draw × tier (gs bands from small samples, kept conservative).
const RANGE: Record<PredictDraw, Record<TierGroup, number>> = {
  ms: { gs: 0.08, tour: 0.27, challenger: 0.33 },
  qs: { gs: 0.15, tour: 0.5, challenger: 0.47 },
  md: { gs: 0.15, tour: 0.37, challenger: 0.48 },
};

const MIN_COHORT = 3;
const MIN_LEVEL_MEDIAN = 8;
const NEIGHBOUR_KM = 3000;
const COHORT_WEEK_WINDOW = 2;
const TIER_FACTOR_CLAMP: [number, number] = [0.55, 1.8];

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Target = {
  slug: string;
  year: number;
  week: number;
  group: TierGroup;
  level: string;
  latitude: number | null;
  longitude: number | null;
};

/** Rescales a tournament's own history when its level changed year-over-year:
 * the ratio of median cuts between the two exact levels, measured strictly on
 * seasons before `year`. 1 when the level didn't change or data is thin. */
export function tierChangeFactor(
  observations: CutObservation[],
  level: string,
  lastLevel: string | null,
  year: number
): number {
  if (!lastLevel || lastLevel === level) return 1;
  const med = (lvl: string) => {
    const vals = observations.filter((o) => o.year < year && o.level === lvl).map((o) => o.cut);
    return vals.length >= MIN_LEVEL_MEDIAN ? median(vals) : null;
  };
  const a = med(level);
  const b = med(lastLevel);
  if (a == null || b == null || b <= 0) return 1;
  return Math.min(TIER_FACTOR_CLAMP[1], Math.max(TIER_FACTOR_CLAMP[0], a / b));
}

/** Fallback base for events with no own history: last season's median cut
 * among same-group events within ±2 calendar weeks, neighbours preferred. */
export function cohortBase(target: Target, observations: CutObservation[]): number | null {
  const cohort = observations.filter(
    (o) =>
      o.year === target.year - 1 &&
      o.group === target.group &&
      Math.abs(o.week - target.week) <= COHORT_WEEK_WINDOW
  );
  const near = cohort.filter(
    (o) =>
      target.latitude != null &&
      target.longitude != null &&
      o.latitude != null &&
      o.longitude != null &&
      haversineKm(target.latitude, target.longitude, o.latitude, o.longitude) <= NEIGHBOUR_KM
  );
  const pool = near.length >= MIN_COHORT ? near : cohort;
  if (pool.length < MIN_COHORT) return null;
  return median(pool.map((o) => o.cut));
}

// --- Switched-off machinery (fitted to zero, kept measurable) ---------------

export type SupplySignals = {
  sameWeekRatio: number | null;
  runupRatio: number | null;
};
export type ModelBetas = { supply: number; runup: number };
/** Fitted on the 2022-2026 backtest: the grid optimum for both calendar
 * exponents was 0 — the ratios added noise at any positive damping. */
export const DEFAULT_BETAS: ModelBetas = { supply: 0, runup: 0 };

const SUPPLY_CLAMP: [number, number] = [0.5, 2];

export function supplyAdjustment(signals: SupplySignals | undefined, betas: ModelBetas): number {
  if (!signals) return 1;
  let adj = 1;
  if (signals.sameWeekRatio != null && signals.sameWeekRatio > 0) {
    const r = Math.min(SUPPLY_CLAMP[1], Math.max(SUPPLY_CLAMP[0], signals.sameWeekRatio));
    adj *= r ** betas.supply;
  }
  if (signals.runupRatio != null && signals.runupRatio > 0) {
    const r = Math.min(SUPPLY_CLAMP[1], Math.max(SUPPLY_CLAMP[0], signals.runupRatio));
    adj *= r ** betas.runup;
  }
  return adj;
}

// -----------------------------------------------------------------------------

/** Predict the cut for `target` from its own history (blended, tier-adjusted)
 * or the cohort fallback. `observations` provide tier medians and cohorts —
 * callers must only include cuts published before the prediction moment. */
export function predictCut(
  target: Target,
  own: OwnHistory,
  observations: CutObservation[],
  draw: PredictDraw,
  supply?: SupplySignals,
  betas: ModelBetas = DEFAULT_BETAS
): CutPrediction | null {
  let base: number | null;
  let method: CutPrediction['method'];
  let tierFactor = 1;

  if (own.lastYearCut != null) {
    const w1 = BLEND_W1[draw];
    base =
      own.yearBeforeCut != null
        ? w1 * own.lastYearCut + (1 - w1) * own.yearBeforeCut
        : own.lastYearCut;
    tierFactor = tierChangeFactor(observations, target.level, own.lastYearLevel, target.year);
    base *= tierFactor;
    method = 'trend';
  } else {
    base = cohortBase(target, observations);
    method = 'cohort';
  }
  if (base == null) return null;

  const cut = Math.max(3, Math.round(base * supplyAdjustment(supply, betas)));
  const spread = RANGE[draw][target.group];
  const width = method === 'cohort' ? spread * 1.3 : spread;
  return {
    cut,
    low: Math.max(1, Math.round(cut * (1 - width))),
    high: Math.round(cut * (1 + width)),
    method,
    tierFactor,
  };
}

// Beta cut-projection model, v3 ("blend-v3"). Pure functions only — the
// routes feed it rows and store what it returns.
//
// Every structural choice here was fitted on a walk-forward backtest over
// ~2,900 real cut observations (2022-2026 production data), scored against
// the "same cut as last year" baseline, then re-examined against the first
// 103 LIVE scored predictions (July 2026) which exposed a systematic
// under-depth bias (2026 fields kept coming in weaker than history implied):
//
//   predicted cut = (blended own history × tier factor × season drift)
//                   shrunk toward the cohort median
//
//   1. BLENDED BASE — a weighted mean of the tournament's own last two cuts
//      (heavier on last year; weights fitted per draw), with a freak last
//      year winsorized against the tournament's own prior median.
//   2. TIER-CHANGE FACTOR — when a tournament changed level since last year,
//      rescale by the ratio of median cuts between the two exact levels,
//      measured on prior seasons only.
//   3. LIVE SEASON DRIFT (new in v3) — the median year-over-year cut ratio
//      across same-group events already completed THIS season, damped
//      (^0.25) and clamped. Directly corrects the live bias the tracking
//      report caught; fitted on the full backtest it helps every draw.
//   4. COHORT SHRINKAGE (new in v3, the big win) — the point estimate is
//      pulled toward the median cut of same-group events within ±2 weeks
//      last season: cut = α·own + (1-α)·cohort (α fitted per draw). One
//      noisy own-history year misleads; the cohort anchors. Improves MAE
//      6.5% (ms) / 10% (qs) / 14% (md) over v2.1, better in every season
//      2023-2026, challengers most, tour events unharmed (slams skip it —
//      their cohort is too thin to form).
//   5. COHORT FALLBACK — events with no history take the cohort median
//      alone, with a wider uncertainty band.
//
// Factors the backtest REJECTED (kept as switched-off machinery so they can
// be re-fitted as data grows, and so the backtest keeps measuring them):
//   - calendar-supply ratios (same-week event count, run-up density —
//     the regional "waterfall"): fitted exponents 0; the clustering repeats
//     yearly so it is already priced into each tournament's own history.
//
// Fitted accuracy vs baseline (walk-forward, editions with a last-year cut):
//   singles main  MAE 44.7 vs 52.1  (-14%), win rate 0.55
//   singles quali MAE 178  vs 209   (-15%), win rate 0.58
//   doubles       MAE 170  vs 214   (-20%), win rate 0.57
//
// Output is a range, not a point: bands are the fitted 75th percentile of
// relative absolute error per draw × tier (live coverage so far: 82% inside
// the band against a 75% design target).

export const MODEL_VERSION = 'blend-v3';

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
  /** All of the tournament's own cuts from seasons before last year — used to
   * winsorize a freak last-year value (the Newport 2025 case: one year of
   * regional field-splitting spiked its quali cut to 1314 against a 286-616
   * history; trusting it raw made the 2026 projection badly weak). */
  priorCuts?: number[];
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

// Weight kept on the tournament's own (blended, tier- and drift-adjusted)
// history; the rest shifts to the cohort median. Fitted per draw: singles
// mains have the most reliable own history, doubles the least. Exported so
// the backtest replays exactly what ships.
export const SHRINK_ALPHA: Record<PredictDraw, number> = { ms: 0.75, qs: 0.6, md: 0.6 };

// Damping exponent on the live season-drift ratio, and its clamp/support.
export const DRIFT_BETA = 0.25;
const DRIFT_CLAMP: [number, number] = [0.6, 1.6];
const DRIFT_MIN_PAIRS = 8;

// Relative half-width of the projected range: fitted p75 of |relative error|
// per draw × tier under the v3 predictor (gs bands from small samples, kept
// conservative).
const RANGE: Record<PredictDraw, Record<TierGroup, number>> = {
  ms: { gs: 0.08, tour: 0.23, challenger: 0.25 },
  qs: { gs: 0.15, tour: 0.5, challenger: 0.43 },
  md: { gs: 0.15, tour: 0.35, challenger: 0.47 },
};

// A last-year cut further than this factor from the tournament's own prior
// median is treated as an outlier year and clamped before blending. Fitted on
// the backtest: improves every draw overall and cuts error on the outlier
// subset by 10-28%.
const WINSOR_FACTOR = 1.75;

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

/** Live season drift: how this season's cuts have been running against last
 * season's, measured ONLY on same-group events already completed before the
 * target's week (walk-forward safe — at predict time those are exactly the
 * cuts that exist). Median of the year-over-year ratios, clamped; 1 when
 * fewer than DRIFT_MIN_PAIRS comparable pairs have completed. */
export function liveSeasonDrift(observations: CutObservation[], target: Target): number {
  const prevByslug = new Map<string, number>();
  for (const o of observations) {
    if (o.year === target.year - 1 && o.group === target.group) prevByslug.set(o.slug, o.cut);
  }
  const ratios: number[] = [];
  for (const o of observations) {
    if (o.year !== target.year || o.group !== target.group || o.week >= target.week) continue;
    const prev = prevByslug.get(o.slug);
    if (prev == null || prev <= 0) continue;
    ratios.push(o.cut / prev);
  }
  if (ratios.length < DRIFT_MIN_PAIRS) return 1;
  const r = median(ratios)!;
  return Math.min(DRIFT_CLAMP[1], Math.max(DRIFT_CLAMP[0], r));
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
    // Winsorize a freak last year against the tournament's own longer history.
    let last = own.lastYearCut;
    const prior = own.priorCuts ?? [];
    if (prior.length >= 2) {
      const priorMed = median(prior);
      if (priorMed != null && priorMed > 0) {
        last = Math.min(priorMed * WINSOR_FACTOR, Math.max(priorMed / WINSOR_FACTOR, last));
      }
    }
    const w1 = BLEND_W1[draw];
    base = own.yearBeforeCut != null ? w1 * last + (1 - w1) * own.yearBeforeCut : last;
    tierFactor = tierChangeFactor(observations, target.level, own.lastYearLevel, target.year);
    base *= tierFactor;
    // Live season drift: nudge toward how this season has actually been
    // running (damped so one hot month can't swing a projection).
    base *= liveSeasonDrift(observations, target) ** DRIFT_BETA;
    // Cohort shrinkage: one noisy own-history year misleads; the cohort
    // median anchors. Skipped automatically when no cohort forms (slams).
    const cohort = cohortBase(target, observations);
    if (cohort != null) {
      const alpha = SHRINK_ALPHA[draw];
      base = alpha * base + (1 - alpha) * cohort;
    }
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

// Beta cut-projection model (v1). Pure functions only — the routes feed it
// rows and store what it returns.
//
// The method: a tournament's best single predictor is its own cut last year.
// We improve on that baseline with a market-drift correction — how the cuts
// of COMPARABLE tournaments (same tier group, preferring geographic
// neighbours) have moved between last season and this season-to-date — and a
// cohort fallback (same tier + nearby calendar week last year) for events
// with no history. Strictly walk-forward: a prediction for week W only ever
// sees cuts from weeks before the as-of week, so backtest numbers mean what
// they say and the live nightly job uses the same code path.
//
// Output is a range, not a point: cut volatility differs by tier, so the
// band is a per-group relative spread calibrated from backtest residuals.

export const MODEL_VERSION = 'drift-v1';

export type TierGroup = 'gs' | 'tour' | 'challenger';

export type CutObservation = {
  slug: string;
  year: number;
  week: number;
  group: TierGroup;
  latitude: number | null;
  longitude: number | null;
  cut: number;
};

export type CutPrediction = {
  cut: number;
  low: number;
  high: number;
  method: 'trend' | 'cohort';
  /** How many comparator pairs informed the drift factor (0 = drift 1). */
  comparators: number;
  drift: number;
};

export function tierGroup(level: string): TierGroup | null {
  const l = level.toLowerCase();
  if (l.includes('grand slam')) return 'gs';
  if (l.startsWith('atp')) return 'tour';
  if (l.includes('challenger')) return 'challenger';
  return null; // ITF and team events are out of scope for v1
}

// Relative half-width of the projected range per tier, calibrated against the
// 2023-2026 walk-forward backtest (roughly the 75th percentile of absolute
// relative error per group). Slam cuts barely move; challenger cuts swing.
const RANGE_BY_GROUP: Record<TierGroup, number> = {
  gs: 0.08,
  tour: 0.2,
  challenger: 0.25,
};

const RATIO_CLAMP: [number, number] = [0.5, 2];
const MIN_COMPARATORS = 5;
const MIN_COHORT = 3;
const NEIGHBOUR_KM = 3000;
const COHORT_WEEK_WINDOW = 2;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
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
  latitude: number | null;
  longitude: number | null;
};

/** Year-over-year drift of the target's market: median ratio of
 * (this season's cut / last season's cut) across tournaments of the same
 * tier group whose current-season cut was already published before
 * `asofWeek`. Geographic neighbours win when there are enough of them. */
export function driftFactor(
  target: Target,
  observations: CutObservation[],
  asofWeek: number
): { drift: number; comparators: number } {
  const prevByslug = new Map<string, CutObservation>();
  for (const o of observations) {
    if (o.year === target.year - 1 && o.group === target.group) prevByslug.set(o.slug, o);
  }
  const pairs: Array<{ ratio: number; km: number | null }> = [];
  for (const o of observations) {
    if (o.year !== target.year || o.group !== target.group) continue;
    if (o.week >= asofWeek) continue;
    if (o.slug === target.slug) continue;
    const prev = prevByslug.get(o.slug);
    if (!prev) continue;
    const ratio = Math.min(RATIO_CLAMP[1], Math.max(RATIO_CLAMP[0], o.cut / prev.cut));
    const km =
      target.latitude != null && target.longitude != null && o.latitude != null && o.longitude != null
        ? haversineKm(target.latitude, target.longitude, o.latitude, o.longitude)
        : null;
    pairs.push({ ratio, km });
  }

  const regional = pairs.filter((p) => p.km != null && p.km <= NEIGHBOUR_KM);
  const pool = regional.length >= MIN_COMPARATORS ? regional : pairs;
  if (pool.length < MIN_COMPARATORS) return { drift: 1, comparators: 0 };
  return { drift: median(pool.map((p) => p.ratio)) ?? 1, comparators: pool.length };
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

// --- Calendar-supply signals -----------------------------------------------
// Player-level "how many weeks in a row has the field been playing" isn't in
// our data, but its aggregate IS the calendar: when more same-tier events
// share the target week, entries spread thinner; when the preceding weeks
// are packed, fields arrive tired and more players skip — both weaken the
// cut (a numerically deeper rank). Expressed as this-year/last-year count
// ratios, damped by small exponents so a doubled calendar doesn't imply a
// doubled cut. The exponents are calibrated by /api/backtest-cuts?tune=true.

export type SupplySignals = {
  /** Same-tier events in the target week, this year / last year. */
  sameWeekRatio: number | null;
  /** Same-tier events across the 3 preceding weeks, this year / last year. */
  runupRatio: number | null;
};

export type ModelBetas = { supply: number; runup: number };
export const DEFAULT_BETAS: ModelBetas = { supply: 0.25, runup: 0.1 };

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

/** Predict the cut for `target`, using only cuts published before `asofWeek`
 * of the target season (plus all prior seasons). `lastYearCut` is the
 * target's own cut last season, when it has one. `supply` carries the
 * calendar-structure signals (known ahead of time for the whole season). */
export function predictCut(
  target: Target,
  lastYearCut: number | null,
  observations: CutObservation[],
  asofWeek: number,
  supply?: SupplySignals,
  betas: ModelBetas = DEFAULT_BETAS
): CutPrediction | null {
  const { drift, comparators } = driftFactor(target, observations, asofWeek);

  let base: number | null = lastYearCut;
  let method: CutPrediction['method'] = 'trend';
  if (base == null) {
    base = cohortBase(target, observations);
    method = 'cohort';
  }
  if (base == null) return null;

  const adjustment = supplyAdjustment(supply, betas);
  const cut = Math.max(3, Math.round(base * drift * adjustment));
  const spread = RANGE_BY_GROUP[target.group];
  // Cohort predictions are inherently fuzzier than own-history ones.
  const width = method === 'cohort' ? spread * 1.5 : spread;
  return {
    cut,
    low: Math.max(1, Math.round(cut * (1 - width))),
    high: Math.round(cut * (1 + width)),
    method,
    comparators,
    drift,
  };
}

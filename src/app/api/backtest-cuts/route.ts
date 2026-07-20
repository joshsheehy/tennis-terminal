import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  cohortBase,
  liveSeasonDrift,
  regionalSwingDrift,
  tierChangeFactor,
  supplyAdjustment,
  median,
  DEFAULT_BETAS,
  DRIFT_BETA,
  REGIONAL_SWING_BETA,
  MODEL_VERSION,
  SHRINK_ALPHA,
  type ModelBetas,
  type SupplySignals,
  type TierGroup,
} from '@/lib/cut-prediction';
import {
  DRAW_META,
  loadCutObservations,
  loadSupplyEvents,
  supplySignalsFor,
  type DrawKey,
} from '@/lib/cut-prediction-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Walk-forward backtest of the cut-projection model against the last-year
// baseline (the number to beat: "same cut as last season"). For every edition
// with a real cut and at least one prior season of data, the model predicts
// it using only cuts published BEFORE that edition's week — exactly the
// information the live nightly job would have had.
//
//   GET /api/backtest-cuts             → all three draws, default betas
//   GET /api/backtest-cuts?draws=ms    → singles main only
//   GET /api/backtest-cuts?tune=true   → also grid-search the calendar-supply
//                                        exponents and report the best pair
//   GET /api/backtest-cuts?horizonWeeks=4,5,6
//                                      → simulate predictions made 4-6 weeks
//                                        before each event, matching ATP
//                                        advance-entry windows (ATP Tour singles
//                                        main is 28 days out; ATP Tour qualifying
//                                        and Challenger singles are 21 days out;
//                                        doubles is 14 days for ATP Tour advance
//                                        entry and 7 days for Challengers), and
//                                        hiding same-season cuts that would not
//                                        have been public
//
// The expensive parts (drift, cohort base) don't depend on the supply betas,
// so each sample stores its base once and the tuner just re-applies betas.

type HorizonReport = {
  overall: unknown;
  byGroup: Record<string, unknown>;
  byYear: Record<string, unknown>;
};

type Sample = {
  group: TierGroup;
  year: number;
  actual: number;
  /** Blended own history × tier factor (or cohort base) — everything except supply. */
  base: number;
  baseline: number | null;
  method: 'trend' | 'cohort';
  supply: SupplySignals;
};

function modelPrediction(sample: Sample, betas: ModelBetas): number {
  return Math.max(3, Math.round(sample.base * supplyAdjustment(sample.supply, betas)));
}

function summarize(samples: Sample[], betas: ModelBetas) {
  const withBaseline = samples.filter((s) => s.baseline != null);
  const mae = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const modelErr = withBaseline.map((s) => Math.abs(modelPrediction(s, betas) - s.actual));
  const baseErr = withBaseline.map((s) => Math.abs((s.baseline as number) - s.actual));
  const wins = withBaseline.filter(
    (s) => Math.abs(modelPrediction(s, betas) - s.actual) < Math.abs((s.baseline as number) - s.actual)
  ).length;
  const ties = withBaseline.filter(
    (s) => Math.abs(modelPrediction(s, betas) - s.actual) === Math.abs((s.baseline as number) - s.actual)
  ).length;
  const relErrs = samples
    .map((s) => Math.abs(modelPrediction(s, betas) - s.actual) / s.actual)
    .sort((a, b) => a - b);
  const q = (p: number) =>
    relErrs.length
      ? Math.round(relErrs[Math.min(relErrs.length - 1, Math.floor(p * relErrs.length))] * 1000) / 1000
      : null;
  return {
    n: samples.length,
    nWithBaseline: withBaseline.length,
    cohortPredictions: samples.filter((s) => s.method === 'cohort').length,
    modelMAE: round(mae(modelErr)),
    baselineMAE: round(mae(baseErr)),
    modelMedianAbsErr: round(median(modelErr)),
    baselineMedianAbsErr: round(median(baseErr)),
    winRate: withBaseline.length
      ? Math.round(((wins + ties / 2) / withBaseline.length) * 1000) / 1000
      : null,
    relAbsErrP50: q(0.5),
    relAbsErrP75: q(0.75),
    relAbsErrP90: q(0.9),
  };
}

function tuneBetas(samples: Sample[]) {
  const grid = { supply: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], runup: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3] };
  let best: { betas: ModelBetas; mae: number } | null = null;
  for (const supply of grid.supply) {
    for (const runup of grid.runup) {
      const betas = { supply, runup };
      const errs = samples.map((s) => Math.abs(modelPrediction(s, betas) - s.actual));
      const mae = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
      if (!best || mae < best.mae) best = { betas, mae };
    }
  }
  return best
    ? { bestBetas: best.betas, bestMAE: Math.round(best.mae * 100) / 100 }
    : null;
}

function parseHorizonWeeks(value: string | null): number[] {
  const parsed = (value ?? '0')
    .split(',')
    .map((v) => Math.round(Number(v.trim())))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 12);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length ? unique : [0];
}

function buildHorizonReport(
  observations: Awaited<ReturnType<typeof loadCutObservations>>,
  supplyEvents: Awaited<ReturnType<typeof loadSupplyEvents>>,
  draw: DrawKey,
  horizonWeeks: number,
  tune: boolean
): HorizonReport {
  const byslugYear = new Map<string, number>();
  for (const o of observations) byslugYear.set(`${o.slug}:${o.year}`, o.cut);
  const years = [...new Set(observations.map((o) => o.year))].sort();

  const levelByslugYear = new Map<string, string>();
  for (const o of observations) levelByslugYear.set(`${o.slug}:${o.year}`, o.level);
  const BLEND_W1 = { ms: 0.7, qs: 0.65, md: 0.8 }[draw];

  const samples: Sample[] = [];
  for (const o of observations) {
    if (o.year <= years[0]) continue; // nothing before the first season
    const lastYearCut = byslugYear.get(`${o.slug}:${o.year - 1}`) ?? null;
    const yearBeforeCut = byslugYear.get(`${o.slug}:${o.year - 2}`) ?? null;
    const predictionWeek = o.week - horizonWeeks;
    // Static previous-season cuts are known at any horizon. Same-season cut
    // observations only become usable after their tournament week has begun,
    // so require p.week < predictionWeek. Using <= leaks same-week events (and
    // at h0 can leak the target itself), which overstates walk-forward accuracy.
    const visible = observations.filter((p) => p.year < o.year || (p.year === o.year && p.week < predictionWeek));
    const prior = observations.filter((p) => p.year < o.year);
    let base: number | null;
    let method: Sample['method'] = 'trend';
    if (lastYearCut != null) {
      // Winsorize a freak last year against own prior history (blend-v2.1).
      let last = lastYearCut;
      const priorCuts: number[] = [];
      for (let y = years[0]; y < o.year - 1; y++) {
        const c = byslugYear.get(`${o.slug}:${y}`);
        if (c != null) priorCuts.push(c);
      }
      if (priorCuts.length >= 2) {
        const priorMed = median(priorCuts);
        if (priorMed != null && priorMed > 0) {
          last = Math.min(priorMed * 1.75, Math.max(priorMed / 1.75, last));
        }
      }
      base = yearBeforeCut != null ? BLEND_W1 * last + (1 - BLEND_W1) * yearBeforeCut : last;
      base *= tierChangeFactor(
        prior,
        o.level,
        levelByslugYear.get(`${o.slug}:${o.year - 1}`) ?? null,
        o.year
      );
      // v4: drift signals only see cuts visible by the simulated horizon;
      // at 4-6 weeks this removes the unpublished entry-list information the
      // live product cannot know yet.
      base *= liveSeasonDrift(visible, o) ** DRIFT_BETA;
      base *= regionalSwingDrift(visible, o) ** REGIONAL_SWING_BETA;
      const cohort = cohortBase(o, prior);
      if (cohort != null) {
        const alpha = SHRINK_ALPHA[draw];
        base = alpha * base + (1 - alpha) * cohort;
      }
    } else {
      base = cohortBase(o, prior);
      method = 'cohort';
    }
    if (base == null) continue;
    samples.push({
      group: o.group,
      year: o.year,
      actual: o.cut,
      base,
      baseline: lastYearCut,
      method,
      supply: supplySignalsFor(supplyEvents, o.year, o.week, o.latitude, o.longitude),
    });
  }

  const byGroup: Record<string, unknown> = {};
  for (const group of ['gs', 'tour', 'challenger'] as TierGroup[]) {
    const groupSamples = samples.filter((s) => s.group === group);
    if (groupSamples.length === 0) continue;
    byGroup[group] = {
      ...summarize(groupSamples, DEFAULT_BETAS),
      ...(tune ? tuneBetas(groupSamples) : {}),
    };
  }
  const byYear: Record<string, unknown> = {};
  for (const year of years.slice(1)) {
    const yearSamples = samples.filter((s) => s.year === year);
    if (yearSamples.length === 0) continue;
    byYear[year] = summarize(yearSamples, DEFAULT_BETAS);
  }

  return {
    overall: {
      ...summarize(samples, DEFAULT_BETAS),
      ...(tune ? tuneBetas(samples) : {}),
    },
    byGroup,
    byYear,
  };
}

export async function GET(request: NextRequest) {
  const drawsParam = request.nextUrl.searchParams.get('draws') ?? 'ms,qs,md';
  const draws = drawsParam.split(',').filter((d): d is DrawKey => d in DRAW_META);
  const tune = request.nextUrl.searchParams.get('tune') === 'true';
  const horizonWeeks = parseHorizonWeeks(request.nextUrl.searchParams.get('horizonWeeks'));

  const supplyEvents = await loadSupplyEvents(pool);
  const report: Record<string, unknown> = {};

  for (const draw of draws) {
    const observations = await loadCutObservations(pool, draw);
    const horizons: Record<string, HorizonReport> = {};
    for (const h of horizonWeeks) {
      horizons[`h${h}`] = buildHorizonReport(observations, supplyEvents, draw, h, tune);
    }
    const primary = horizons[`h${horizonWeeks[0]}`];
    report[draw] = {
      label: DRAW_META[draw].label,
      observations: observations.length,
      horizonWeeks,
      overall: primary.overall,
      byGroup: primary.byGroup,
      byYear: primary.byYear,
      horizons,
    };
  }

  return NextResponse.json({
    ok: true,
    modelVersion: MODEL_VERSION,
    betas: DEFAULT_BETAS,
    tuned: tune,
    horizonWeeks,
    note: 'Walk-forward: previous-season cuts are known, while same-season drift signals only see cuts completed before the simulated prediction week. baseline = same cut as last year.',
    report,
  });
}

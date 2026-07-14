import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  cohortBase,
  liveSeasonDrift,
  tierChangeFactor,
  supplyAdjustment,
  median,
  DEFAULT_BETAS,
  DRIFT_BETA,
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
//
// The expensive parts (drift, cohort base) don't depend on the supply betas,
// so each sample stores its base once and the tuner just re-applies betas.

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

export async function GET(request: NextRequest) {
  const drawsParam = request.nextUrl.searchParams.get('draws') ?? 'ms,qs,md';
  const draws = drawsParam.split(',').filter((d): d is DrawKey => d in DRAW_META);
  const tune = request.nextUrl.searchParams.get('tune') === 'true';

  const supplyEvents = await loadSupplyEvents(pool);
  const report: Record<string, unknown> = {};

  for (const draw of draws) {
    const observations = await loadCutObservations(pool, draw);
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
      // Walk-forward: only prior-season observations feed the tier medians.
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
        base =
          yearBeforeCut != null
            ? BLEND_W1 * last + (1 - BLEND_W1) * yearBeforeCut
            : last;
        base *= tierChangeFactor(
          prior,
          o.level,
          levelByslugYear.get(`${o.slug}:${o.year - 1}`) ?? null,
          o.year
        );
        // v3: live season drift + cohort shrinkage, same as predictCut.
        // liveSeasonDrift only reads same-season cuts from weeks before o's,
        // so passing the full observation set stays walk-forward.
        base *= liveSeasonDrift(observations, o) ** DRIFT_BETA;
        const cohort = cohortBase(o, prior);
        if (cohort != null) {
          const alpha = SHRINK_ALPHA[draw];
          base = alpha * base + (1 - alpha) * cohort;
        }
      } else {
        base = cohortBase(o, observations);
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

    report[draw] = {
      label: DRAW_META[draw].label,
      observations: observations.length,
      overall: {
        ...summarize(samples, DEFAULT_BETAS),
        ...(tune ? tuneBetas(samples) : {}),
      },
      byGroup,
      byYear,
    };
  }

  return NextResponse.json({
    ok: true,
    modelVersion: MODEL_VERSION,
    betas: DEFAULT_BETAS,
    tuned: tune,
    note: 'Walk-forward: each prediction only saw cuts from weeks before its own. baseline = same cut as last year.',
    report,
  });
}

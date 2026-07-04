import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { predictCut, MODEL_VERSION, median, type TierGroup } from '@/lib/cut-prediction';
import { DRAW_META, loadCutObservations, type DrawKey } from '@/lib/cut-prediction-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Walk-forward backtest of the cut-projection model against the last-year
// baseline (the number to beat: "same cut as last season"). For every edition
// with a real cut and at least one prior season of data, the model predicts
// it using only cuts published BEFORE that edition's week — exactly the
// information the live nightly job would have had.
//
//   GET /api/backtest-cuts            → all three draws
//   GET /api/backtest-cuts?draws=ms   → singles main only
//
// Read the report per tier group: modelMAE < baselineMAE (and winRate > 0.5)
// means the drift correction is earning its keep.

type Sample = {
  group: TierGroup;
  year: number;
  actual: number;
  model: number;
  baseline: number | null;
  method: string;
};

function summarize(samples: Sample[]) {
  const withBaseline = samples.filter((s) => s.baseline != null);
  const mae = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const modelErr = withBaseline.map((s) => Math.abs(s.model - s.actual));
  const baseErr = withBaseline.map((s) => Math.abs((s.baseline as number) - s.actual));
  const wins = withBaseline.filter(
    (s) => Math.abs(s.model - s.actual) < Math.abs((s.baseline as number) - s.actual)
  ).length;
  const ties = withBaseline.filter(
    (s) => Math.abs(s.model - s.actual) === Math.abs((s.baseline as number) - s.actual)
  ).length;
  const relErrs = samples.map((s) => Math.abs(s.model - s.actual) / s.actual).sort((a, b) => a - b);
  const q = (p: number) =>
    relErrs.length ? Math.round(relErrs[Math.min(relErrs.length - 1, Math.floor(p * relErrs.length))] * 1000) / 1000 : null;
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

export async function GET(request: NextRequest) {
  const drawsParam = request.nextUrl.searchParams.get('draws') ?? 'ms,qs,md';
  const draws = drawsParam.split(',').filter((d): d is DrawKey => d in DRAW_META);

  const report: Record<string, unknown> = {};

  for (const draw of draws) {
    const observations = await loadCutObservations(pool, draw);
    const byslugYear = new Map<string, number>();
    for (const o of observations) byslugYear.set(`${o.slug}:${o.year}`, o.cut);
    const years = [...new Set(observations.map((o) => o.year))].sort();

    const samples: Sample[] = [];
    for (const o of observations) {
      if (o.year <= years[0]) continue; // nothing before the first season
      const lastYearCut = byslugYear.get(`${o.slug}:${o.year - 1}`) ?? null;
      const prediction = predictCut(o, lastYearCut, observations, o.week);
      if (!prediction) continue;
      samples.push({
        group: o.group,
        year: o.year,
        actual: o.cut,
        model: prediction.cut,
        baseline: lastYearCut,
        method: prediction.method,
      });
    }

    const byGroup: Record<string, unknown> = {};
    for (const group of ['gs', 'tour', 'challenger'] as TierGroup[]) {
      const groupSamples = samples.filter((s) => s.group === group);
      if (groupSamples.length === 0) continue;
      byGroup[group] = summarize(groupSamples);
    }
    const byYear: Record<string, unknown> = {};
    for (const year of years.slice(1)) {
      const yearSamples = samples.filter((s) => s.year === year);
      if (yearSamples.length === 0) continue;
      byYear[year] = summarize(yearSamples);
    }

    report[draw] = {
      label: DRAW_META[draw].label,
      observations: observations.length,
      overall: summarize(samples),
      byGroup,
      byYear,
    };
  }

  return NextResponse.json({
    ok: true,
    modelVersion: MODEL_VERSION,
    note: 'Walk-forward: each prediction only saw cuts from weeks before its own. baseline = same cut as last year.',
    report,
  });
}

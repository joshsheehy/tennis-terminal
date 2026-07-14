import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { median } from '@/lib/cut-prediction';
import { ensurePredictionsTable } from '@/lib/cut-prediction-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only tracking report for the beta cut projections: every stored
// prediction that has since been scored against a real cut, sliced by draw,
// horizon, method and model version. This is the live complement to
// /api/backtest-cuts — the backtest replays history, this measures what the
// nightly job actually shipped.
//
//   GET /api/cut-prediction-report            → aggregate stats + worst misses
//   GET /api/cut-prediction-report?rows=all   → include every scored row

type ScoredRow = {
  slug: string;
  name: string;
  level: string;
  year: number;
  week: number | null;
  event_type: string;
  draw_type: string;
  horizon_weeks: number;
  predicted_cut: number;
  predicted_low: number;
  predicted_high: number;
  method: string;
  model_version: string;
  predicted_at: string;
  actual_cut: number;
  baseline_cut: number | null;
};

function drawKey(r: { event_type: string; draw_type: string }): string {
  if (r.event_type === 'doubles') return 'md';
  return r.draw_type === 'qualifying' ? 'qs' : 'ms';
}

function summarize(rows: ScoredRow[]) {
  if (rows.length === 0) return null;
  const errs = rows.map((r) => Math.abs(r.predicted_cut - r.actual_cut));
  const rel = rows.map((r) => Math.abs(r.predicted_cut - r.actual_cut) / r.actual_cut);
  const bias = rows.map((r) => r.predicted_cut - r.actual_cut);
  const inRange = rows.filter(
    (r) => r.actual_cut >= r.predicted_low && r.actual_cut <= r.predicted_high
  ).length;
  const withBaseline = rows.filter((r) => r.baseline_cut != null);
  const baseErrs = withBaseline.map((r) => Math.abs((r.baseline_cut as number) - r.actual_cut));
  const wins = withBaseline.filter(
    (r) =>
      Math.abs(r.predicted_cut - r.actual_cut) <
      Math.abs((r.baseline_cut as number) - r.actual_cut)
  ).length;
  const ties = withBaseline.filter(
    (r) =>
      Math.abs(r.predicted_cut - r.actual_cut) ===
      Math.abs((r.baseline_cut as number) - r.actual_cut)
  ).length;
  const round = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    n: rows.length,
    mae: round(mean(errs)),
    medianAbsErr: round(median(errs)),
    medianRelErr: round(median(rel)),
    meanBias: round(mean(bias)),
    rangeCoverage: round(inRange / rows.length),
    nWithBaseline: withBaseline.length,
    baselineMAE: round(mean(baseErrs)),
    winRateVsBaseline: withBaseline.length
      ? round((wins + ties / 2) / withBaseline.length)
      : null,
  };
}

export async function GET(request: NextRequest) {
  const allRows = request.nextUrl.searchParams.get('rows') === 'all';
  await ensurePredictionsTable(pool);

  // Scored predictions with the naive baseline (the same tournament + draw's
  // cut from the previous season) joined on for comparison.
  const scored = await pool.query<ScoredRow>(
    `
    with cuts as (
      select
        cs.tournament_edition_id, cs.event_type, cs.draw_type,
        case
          when cs.event_type = 'doubles'
            then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_alternate_rank, cs.last_direct_acceptance_rank)
          else coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank)
        end as cut
      from cutoff_snapshots cs
    )
    select
      t.slug, t.name, te.level, te.year, te.week,
      cp.event_type, cp.draw_type, cp.horizon_weeks,
      cp.predicted_cut, cp.predicted_low, cp.predicted_high,
      cp.method, cp.model_version, cp.predicted_at,
      cp.actual_cut,
      prev_cut.cut as baseline_cut
    from cut_predictions cp
    join tournament_editions te on te.id = cp.tournament_edition_id
    join tournaments t on t.id = te.tournament_id
    left join tournament_editions prev
      on prev.tournament_id = te.tournament_id and prev.year = te.year - 1
    left join cuts prev_cut
      on prev_cut.tournament_edition_id = prev.id
     and prev_cut.event_type = cp.event_type
     and prev_cut.draw_type = cp.draw_type
    where cp.actual_cut is not null
    order by te.year, te.week, t.slug, cp.event_type, cp.draw_type, cp.horizon_weeks
    `
  );
  const rows = scored.rows;

  const pending = await pool.query<{ n: string; earliest: string | null }>(
    `select count(*) as n, min(predicted_at)::text as earliest
       from cut_predictions where actual_cut is null`
  );

  const byDraw: Record<string, unknown> = {};
  for (const key of ['ms', 'qs', 'md']) {
    const sub = rows.filter((r) => drawKey(r) === key);
    if (sub.length) byDraw[key] = summarize(sub);
  }
  const byHorizon: Record<string, unknown> = {};
  for (const h of [...new Set(rows.map((r) => r.horizon_weeks))].sort((a, b) => a - b)) {
    byHorizon[`h${h}`] = summarize(rows.filter((r) => r.horizon_weeks === h));
  }
  const byMethod: Record<string, unknown> = {};
  for (const m of [...new Set(rows.map((r) => r.method))]) {
    byMethod[m] = summarize(rows.filter((r) => r.method === m));
  }
  const byVersion: Record<string, unknown> = {};
  for (const v of [...new Set(rows.map((r) => r.model_version))]) {
    byVersion[v] = summarize(rows.filter((r) => r.model_version === v));
  }
  const byTier: Record<string, unknown> = {};
  for (const tier of [...new Set(rows.map((r) => r.level))].sort()) {
    const sub = rows.filter((r) => r.level === tier);
    if (sub.length >= 3) byTier[tier] = summarize(sub);
  }

  const detail = (r: ScoredRow) => ({
    slug: r.slug,
    level: r.level,
    year: r.year,
    week: r.week,
    draw: drawKey(r),
    horizon: r.horizon_weeks,
    predicted: r.predicted_cut,
    range: [r.predicted_low, r.predicted_high],
    actual: r.actual_cut,
    baseline: r.baseline_cut,
    method: r.method,
    version: r.model_version,
    relErr: Math.round((Math.abs(r.predicted_cut - r.actual_cut) / r.actual_cut) * 1000) / 1000,
  });

  const worst = [...rows]
    .sort(
      (a, b) =>
        Math.abs(b.predicted_cut - b.actual_cut) / b.actual_cut -
        Math.abs(a.predicted_cut - a.actual_cut) / a.actual_cut
    )
    .slice(0, 25)
    .map(detail);

  return NextResponse.json({
    ok: true,
    scored: rows.length,
    pending: { n: Number(pending.rows[0]?.n ?? 0), earliest: pending.rows[0]?.earliest ?? null },
    overall: summarize(rows),
    byDraw,
    byHorizon,
    byMethod,
    byVersion,
    byTier,
    worstMisses: worst,
    ...(allRows ? { rows: rows.map(detail) } : {}),
  });
}

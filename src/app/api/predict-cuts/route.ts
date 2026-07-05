import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';
import { getAtpWeekForSeason } from '@/lib/atp-week';
import { predictCut, tierGroup, MODEL_VERSION } from '@/lib/cut-prediction';
import {
  DRAW_META,
  drawsForLevel,
  ensurePredictionsTable,
  loadCutObservations,
  loadSupplyEvents,
  supplySignalsFor,
  type DrawKey,
} from '@/lib/cut-prediction-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The beta cut-projection job. Two passes, both idempotent:
//
//   1. PREDICT — for every ATP/Challenger/Slam edition starting within the
//      next `weeksAhead` weeks (default 8 — long enough to plan a schedule
//      around; entry deadlines sit 4-6 weeks out, so an 8-week projection is
//      only reaching a few weeks past the deadline), project each draw and
//      upsert one row per (edition, draw, horizon bucket). Running nightly,
//      an event accumulates snapshots at 8…1 weeks out, so accuracy per lead
//      time is measurable.
//   2. SCORE — fill actual_cut on any stored prediction whose real cut has
//      since been imported.
//
//   GET /api/predict-cuts                → dry run (report, no writes)
//   GET /api/predict-cuts?apply=true     → write predictions + scores

const DEFAULT_WEEKS_AHEAD = 8;

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const weeksAhead = Math.min(
    12,
    Math.max(1, Number(request.nextUrl.searchParams.get('weeksAhead')) || DEFAULT_WEEKS_AHEAD)
  );

  await ensurePredictionsTable(pool);

  // Upcoming editions inside the horizon window.
  const upcoming = await pool.query<{
    edition_id: string;
    slug: string;
    name: string;
    year: number;
    week: number | null;
    start_date: string | Date;
    level: string;
    latitude: number | null;
    longitude: number | null;
    days_out: number;
  }>(
    `
    select
      te.id as edition_id, t.slug, t.name, te.year, te.week, te.start_date, te.level,
      t.latitude, t.longitude,
      (te.start_date - current_date) as days_out
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.start_date >= current_date
      and te.start_date < current_date + ($1 * 7 + 1) * interval '1 day'
    order by te.start_date, t.slug
    `,
    [weeksAhead]
  );

  const observationsByDraw = new Map<DrawKey, Awaited<ReturnType<typeof loadCutObservations>>>();
  for (const draw of Object.keys(DRAW_META) as DrawKey[]) {
    observationsByDraw.set(draw, await loadCutObservations(pool, draw));
  }
  const supplyEvents = await loadSupplyEvents(pool);

  const predictions: Array<{
    slug: string;
    year: number;
    draw: DrawKey;
    horizon: number;
    cut: number;
    low: number;
    high: number;
    method: string;
  }> = [];
  let written = 0;
  let skippedNoModel = 0;

  for (const row of upcoming.rows) {
    const horizon = Math.max(0, Math.ceil(Number(row.days_out) / 7));
    for (const draw of drawsForLevel(row.level)) {
      const observations = observationsByDraw.get(draw)!;
      const group = tierGroup(row.level);
      if (!group) continue;
      const week =
        row.week ?? getAtpWeekForSeason(row.start_date instanceof Date ? row.start_date : String(row.start_date), row.year) ?? null;
      if (week == null) continue;

      const lastYear = observations.find((o) => o.slug === row.slug && o.year === row.year - 1);
      const yearBefore = observations.find((o) => o.slug === row.slug && o.year === row.year - 2);
      const priorCuts = observations
        .filter((o) => o.slug === row.slug && o.year < row.year - 1)
        .map((o) => o.cut);
      const target = {
        slug: row.slug,
        year: row.year,
        week,
        group,
        level: row.level,
        latitude: row.latitude,
        longitude: row.longitude,
      };
      const supply = supplySignalsFor(supplyEvents, row.year, week, row.latitude, row.longitude);
      const prediction = predictCut(
        target,
        {
          lastYearCut: lastYear?.cut ?? null,
          yearBeforeCut: yearBefore?.cut ?? null,
          lastYearLevel: lastYear?.level ?? null,
          priorCuts,
        },
        observations,
        draw,
        supply
      );
      if (!prediction) {
        skippedNoModel += 1;
        continue;
      }

      if (apply) {
        const meta = DRAW_META[draw];
        await pool.query(
          `
          insert into cut_predictions (
            tournament_edition_id, event_type, draw_type, horizon_weeks,
            predicted_cut, predicted_low, predicted_high, method, model_version, predicted_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
          on conflict (tournament_edition_id, event_type, draw_type, horizon_weeks)
          do update set
            predicted_cut = excluded.predicted_cut,
            predicted_low = excluded.predicted_low,
            predicted_high = excluded.predicted_high,
            method = excluded.method,
            model_version = excluded.model_version,
            predicted_at = now()
          `,
          [
            row.edition_id,
            meta.eventType,
            meta.drawType,
            horizon,
            prediction.cut,
            prediction.low,
            prediction.high,
            prediction.method,
            MODEL_VERSION,
          ]
        );
        written += 1;
      }
      predictions.push({
        slug: row.slug,
        year: row.year,
        draw,
        horizon,
        cut: prediction.cut,
        low: prediction.low,
        high: prediction.high,
        method: prediction.method,
      });
    }
  }

  // SCORE: attach actuals to any unscored prediction whose cut has arrived.
  let scored = 0;
  if (apply) {
    const result = await pool.query(
      `
      update cut_predictions cp
      set actual_cut = sub.cut, scored_at = now()
      from (
        select cs.tournament_edition_id, cs.event_type, cs.draw_type,
          case
            when cs.event_type = 'doubles'
              then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_alternate_rank, cs.last_direct_acceptance_rank)
            else coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank)
          end as cut
        from cutoff_snapshots cs
      ) sub
      where cp.scored_at is null
        and sub.cut is not null
        and sub.tournament_edition_id = cp.tournament_edition_id
        and sub.event_type = cp.event_type
        and sub.draw_type = cp.draw_type
      `
    );
    scored = result.rowCount ?? 0;
    if (written > 0 || scored > 0) {
      try {
        revalidateTag('schedule');
      } catch {
        // revalidateTag can throw outside the cache runtime; safe to swallow.
      }
    }
  }

  return NextResponse.json({
    ok: true,
    apply,
    modelVersion: MODEL_VERSION,
    weeksAhead,
    upcomingEditions: upcoming.rows.length,
    predictionCount: predictions.length,
    written,
    scored,
    skippedNoModel,
    predictions: predictions.slice(0, 80),
    message: apply ? 'Predictions written and actuals scored.' : 'Dry run. Append ?apply=true to write.',
  });
}

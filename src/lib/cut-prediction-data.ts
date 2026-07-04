// DB plumbing for the cut-projection model: pulls cut observations in the
// shape src/lib/cut-prediction.ts expects. Shared by /api/backtest-cuts and
// /api/predict-cuts so the backtest exercises exactly the data the live job
// predicts from.

import type { Pool } from 'pg';
import { tierGroup, type CutObservation, type TierGroup } from './cut-prediction';

export type DrawKey = 'ms' | 'qs' | 'md';

export const DRAW_META: Record<
  DrawKey,
  { eventType: 'singles' | 'doubles'; drawType: 'main' | 'qualifying'; label: string }
> = {
  ms: { eventType: 'singles', drawType: 'main', label: 'singles main' },
  qs: { eventType: 'singles', drawType: 'qualifying', label: 'singles qualifying' },
  md: { eventType: 'doubles', drawType: 'main', label: 'doubles main' },
};

/** The draws a level actually runs (slams split across two entries). */
export function drawsForLevel(level: string): DrawKey[] {
  const l = level.toLowerCase();
  if (l === 'grand slam qualifying') return ['qs'];
  if (l === 'grand slam') return ['ms', 'md'];
  return ['ms', 'qs', 'md'];
}

// The same rank precedence the rest of the site displays: post-alternates cut
// when recorded, Challenger doubles use the advanced-entry cut.
const CUT_EXPR = `
  case
    when cs.event_type = 'doubles'
      then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_alternate_rank, cs.last_direct_acceptance_rank)
    else coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank)
  end
`;

export type ObservationRow = CutObservation & { editionId: string };

export async function loadCutObservations(
  pool: Pool,
  draw: DrawKey
): Promise<ObservationRow[]> {
  const meta = DRAW_META[draw];
  const result = await pool.query<{
    edition_id: string;
    slug: string;
    year: number;
    week: number;
    level: string;
    latitude: number | null;
    longitude: number | null;
    cut: number | null;
  }>(
    `
    select
      te.id as edition_id,
      t.slug,
      te.year,
      te.week,
      te.level,
      t.latitude,
      t.longitude,
      ${CUT_EXPR} as cut
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where cs.event_type = $1
      and cs.draw_type = $2
      and te.status = 'held'
      and te.week is not null
    `,
    [meta.eventType, meta.drawType]
  );

  const rows: ObservationRow[] = [];
  for (const r of result.rows) {
    const group: TierGroup | null = tierGroup(r.level);
    if (!group || r.cut == null || r.cut < 3) continue;
    rows.push({
      editionId: r.edition_id,
      slug: r.slug,
      year: r.year,
      week: r.week,
      group,
      latitude: r.latitude,
      longitude: r.longitude,
      cut: r.cut,
    });
  }
  return rows;
}

/** Idempotent DDL from sql/012_create_cut_predictions.sql, mirroring the
 * /api/setup pattern so the deployed app can create the table itself. */
export async function ensurePredictionsTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists cut_predictions (
      id uuid primary key default gen_random_uuid(),
      tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
      event_type text not null check (event_type in ('singles', 'doubles')),
      draw_type text not null check (draw_type in ('main', 'qualifying')),
      horizon_weeks int not null,
      predicted_cut int not null,
      predicted_low int not null,
      predicted_high int not null,
      method text not null,
      model_version text not null,
      predicted_at timestamptz not null default now(),
      actual_cut int,
      scored_at timestamptz,
      created_at timestamptz not null default now(),
      unique (tournament_edition_id, event_type, draw_type, horizon_weeks)
    )
  `);
  await pool.query(
    'create index if not exists cut_predictions_edition_idx on cut_predictions(tournament_edition_id)'
  );
  await pool.query(
    'create index if not exists cut_predictions_unscored_idx on cut_predictions(scored_at) where scored_at is null'
  );
}

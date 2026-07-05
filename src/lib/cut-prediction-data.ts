// DB plumbing for the cut-projection model: pulls cut observations in the
// shape src/lib/cut-prediction.ts expects. Shared by /api/backtest-cuts and
// /api/predict-cuts so the backtest exercises exactly the data the live job
// predicts from.

import type { Pool } from 'pg';
import { haversineKm, tierGroup, type CutObservation, type SupplySignals, type TierGroup } from './cut-prediction';

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
      level: r.level,
      latitude: r.latitude,
      longitude: r.longitude,
      cut: r.cut,
    });
  }
  return rows;
}

// --- Regional "waterfall" supply --------------------------------------------
// The hypothesis this measures: events of ALL levels clustered in a region
// across a week commit players and weaken the smaller events' cuts. On the
// 2022-2026 backtest the year-over-year change in this mass showed no
// residual signal (corr ~ -0.03; the clustering repeats yearly, so it is
// already priced into each tournament's own history) and its fitted exponents
// are 0 — but it is kept fully wired so every backtest run re-measures it as
// seasons accumulate. Tier-weighted (a Slam commits more players than a
// Challenger 50), ITF included, geocoded editions only.

export type SupplyEvent = { year: number; week: number; lat: number; lon: number; weight: number };

const SUPPLY_RADIUS_KM = 3000;
const SUPPLY_WEEK_SPREAD = 1;

function supplyWeight(level: string): number {
  const l = level.toLowerCase();
  if (l.includes('grand slam')) return 3;
  if (l.startsWith('atp')) return 2;
  if (l.includes('challenger')) return 1;
  return 0.5; // ITF
}

export async function loadSupplyEvents(pool: Pool): Promise<SupplyEvent[]> {
  const result = await pool.query<{ year: number; week: number; level: string; latitude: number | null; longitude: number | null }>(
    `select te.year, te.week, te.level, t.latitude, t.longitude
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held' and te.week is not null`
  );
  const events: SupplyEvent[] = [];
  for (const r of result.rows) {
    if (r.latitude == null || r.longitude == null) continue;
    events.push({ year: r.year, week: r.week, lat: r.latitude, lon: r.longitude, weight: supplyWeight(r.level) });
  }
  return events;
}

function regionalMass(events: SupplyEvent[], year: number, week: number, lat: number, lon: number): number {
  let mass = 0;
  for (const e of events) {
    if (e.year !== year || Math.abs(e.week - week) > SUPPLY_WEEK_SPREAD) continue;
    if (haversineKm(lat, lon, e.lat, e.lon) > SUPPLY_RADIUS_KM) continue;
    mass += e.weight;
  }
  return mass;
}

/** Year-over-year regional supply signals for a target. sameWeekRatio is the
 * committed-player mass around the target (week ±1, 3000km, all levels) this
 * year vs last, +1-smoothed; runupRatio the same for the 3 preceding weeks. */
export function supplySignalsFor(
  events: SupplyEvent[],
  year: number,
  week: number,
  lat: number | null,
  lon: number | null
): SupplySignals {
  if (lat == null || lon == null) return { sameWeekRatio: null, runupRatio: null };
  const same = (y: number) => regionalMass(events, y, week, lat, lon);
  const runup = (y: number) =>
    regionalMass(events, y, week - 2, lat, lon) + regionalMass(events, y, week - 3, lat, lon);
  return {
    sameWeekRatio: (same(year) + 1) / (same(year - 1) + 1),
    runupRatio: (runup(year) + 1) / (runup(year - 1) + 1),
  };
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

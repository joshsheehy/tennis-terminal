// DB plumbing for competitive depth. Mirrors src/lib/cut-prediction-data.ts so
// the validator exercises exactly the rows the feature would read.

import type { Pool } from 'pg';
import type { DepthEvent, Discipline } from './depth';

export async function loadDepthEvents(pool: Pool): Promise<DepthEvent[]> {
  const result = await pool.query<{
    edition_id: string;
    slug: string;
    name: string;
    year: number;
    week: number;
    level: string;
    surface: string;
    indoor: boolean | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    `select te.id as edition_id, t.slug, t.name, te.year, te.week, te.level,
            te.surface, te.indoor, t.latitude, t.longitude
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held' and te.week is not null`
  );
  return result.rows.map((r) => ({
    editionId: r.edition_id,
    slug: r.slug,
    name: r.name,
    year: r.year,
    week: r.week,
    level: r.level,
    surface: r.surface,
    indoor: r.indoor,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

export type DepthObservation = {
  editionId: string;
  slug: string;
  name: string;
  year: number;
  week: number;
  level: string;
  /** The boundary from the bottom of the acceptance list, BEFORE alternates.
   * This is the quantity the spec calls da_cut_at_deadline. */
  daCut: number | null;
  /** Post-alternate boundary. Reported for coverage only — never mixed into a
   * model input alongside daCut. */
  alternateCut: number | null;
  /** What the existing projection model actually trains on today. */
  legacyCut: number | null;
  alternateEntries: number;
};

/**
 * Cut observations with the direct-acceptance and post-alternate boundaries
 * kept SEPARATE.
 *
 * This matters more than it looks. The shipped model's CUT_EXPR in
 * cut-prediction-data.ts coalesces `last_alternate_rank` FIRST for both
 * disciplines, so every fitted constant in cut-prediction.ts was trained on a
 * mixture: the post-alternate cut where one was recorded, the direct-acceptance
 * cut where it was not. `legacyCut` reproduces that expression exactly so the
 * validator can measure how far apart the two definitions actually are before
 * anything is changed.
 */
export async function loadDepthObservations(
  pool: Pool,
  discipline: Discipline,
  drawType: 'main' | 'qualifying' = 'main'
): Promise<DepthObservation[]> {
  const result = await pool.query<{
    edition_id: string;
    slug: string;
    name: string;
    year: number;
    week: number;
    level: string;
    da_cut: number | null;
    alternate_cut: number | null;
    legacy_cut: number | null;
    alternate_entries: number;
  }>(
    `select
       te.id as edition_id, t.slug, t.name, te.year, te.week, te.level,
       case
         when cs.event_type = 'doubles'
           then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_direct_acceptance_rank)
         else cs.last_direct_acceptance_rank
       end as da_cut,
       cs.last_alternate_rank as alternate_cut,
       case
         when cs.event_type = 'doubles'
           then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_alternate_rank, cs.last_direct_acceptance_rank)
         else coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank)
       end as legacy_cut,
       cs.alternate_entries_count as alternate_entries
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     join cutoff_snapshots cs on cs.tournament_edition_id = te.id
     where cs.event_type = $1 and cs.draw_type = $2
       and te.status = 'held' and te.week is not null`,
    [discipline, drawType]
  );
  return result.rows.map((r) => ({
    editionId: r.edition_id,
    slug: r.slug,
    name: r.name,
    year: r.year,
    week: r.week,
    level: r.level,
    daCut: r.da_cut,
    alternateCut: r.alternate_cut,
    legacyCut: r.legacy_cut,
    alternateEntries: r.alternate_entries ?? 0,
  }));
}

// --- Saturation -------------------------------------------------------------
// Depth assumes events fill from the top of a shared regional pool downward. In
// weeks where supply exceeds the players actually present, the lower events do
// not fill from the pool at all — they take whoever entered, and the observed
// cut stops being a position. Doubles is worse: 16-team draws in thin weeks
// routinely reach alternates at the deadline.

/** Cut ranks beyond which a draw has plainly stopped filling from a contested
 * pool. Deliberately generous — this excludes obvious non-positions, it is not
 * a tuned parameter. */
export const SATURATION_CUT = { singles: 600, doubles: 500 } as const;

export function isSaturated(obs: DepthObservation, discipline: Discipline): boolean {
  const cut = obs.daCut;
  if (cut == null) return true;
  if (cut > SATURATION_CUT[discipline]) return true;
  // The acceptance list did not fill: alternates were needed to make the draw.
  if (obs.alternateEntries > 0) return true;
  return false;
}

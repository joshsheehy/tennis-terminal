// Year-over-year field strength for every scorable event in a season.
//
// Reads the cuts already stored in cutoff_snapshots via loadDepthObservations
// and scores them; nothing is fetched or recomputed.

import type { Pool } from 'pg';
import { loadDepthObservations, loadDepthEvents } from './depth-data';
import type { Discipline } from './depth';
import { itfNearby, itfNote, type ItfNearby } from './itf-drain';
import {
  buildCohorts,
  isScorableLevel,
  strengthBand,
  strengthScore,
  type StrengthBand,
} from './field-strength';

/** Where this season's number came from. A projection is the existing nightly
 * cut model read from cut_predictions, not a new estimate. */
export type StrengthBasis = 'actual' | 'projected';

export type StrengthRow = {
  slug: string;
  name: string;
  week: number;
  level: string;
  /** Level last season, when the event changed tier — a strength move across a
   * tier change is not like-for-like and the UI must say so. */
  priorLevel: string | null;
  cut: number | null;
  priorCut: number | null;
  score: number | null;
  priorScore: number | null;
  delta: number | null;
  band: StrengthBand | null;
  levelChanged: boolean;
  basis: StrengthBasis | null;
  /** Strength range implied by the projection's own low/high cut bounds.
   * Absent for measured rows, which have no uncertainty to show. */
  scoreLow: number | null;
  scoreHigh: number | null;
  /** ITF events within reach that week, and how much they overlap this level. */
  itf: ItfNearby | null;
  itfNote: string | null;
};

export type StrengthView = {
  year: number;
  discipline: Discipline;
  drawType: 'main' | 'qualifying';
  rows: StrengthRow[];
  /** Levels with too few recorded cuts to score against. */
  unscoredLevels: string[];
  /** Median move across every compared event this season. Fields drift tour-wide
   * — 2025 came in about 5 points weaker overall — so an event that moved by
   * roughly this much held its position rather than changing. */
  seasonMedianDelta: number | null;
  counts: {
    total: number;
    scored: number;
    compared: number;
    projected: number;
  };
};

/** Latest projection per edition+draw from the nightly cut model. Mirrors
 * loadCutProjections in swings-page-data.ts: smallest horizon first, then most
 * recent. Returns an empty map if the table has not been created yet. */
async function loadProjections(
  pool: Pool,
  year: number,
  discipline: Discipline,
  drawType: 'main' | 'qualifying'
): Promise<Map<string, { cut: number; low: number; high: number }>> {
  try {
    const result = await pool.query<{
      slug: string;
      predicted_cut: number;
      predicted_low: number;
      predicted_high: number;
    }>(
      `select distinct on (t.slug)
         t.slug, cp.predicted_cut, cp.predicted_low, cp.predicted_high
       from cut_predictions cp
       join tournament_editions te on te.id = cp.tournament_edition_id
       join tournaments t on t.id = te.tournament_id
       where te.year = $1 and cp.event_type = $2 and cp.draw_type = $3
       order by t.slug, cp.horizon_weeks asc, cp.predicted_at desc`,
      [year, discipline, drawType]
    );
    return new Map(
      result.rows.map((r) => [
        r.slug,
        { cut: r.predicted_cut, low: r.predicted_low, high: r.predicted_high },
      ])
    );
  } catch {
    return new Map(); // cut_predictions not created yet
  }
}

export async function buildStrengthView(
  pool: Pool,
  year: number,
  discipline: Discipline,
  drawType: 'main' | 'qualifying' = 'main'
): Promise<StrengthView> {
  const [observations, events, projections] = await Promise.all([
    loadDepthObservations(pool, discipline, drawType),
    loadDepthEvents(pool),
    loadProjections(pool, year, discipline, drawType),
  ]);

  // ITF drain is measured against every event in the week, including the ITF
  // rows that loadDepthObservations never sees (they carry no cuts).
  const byWeek = new Map<number, typeof events>();
  for (const e of events) {
    if (e.year !== year) continue;
    const list = byWeek.get(e.week);
    if (list) list.push(e);
    else byWeek.set(e.week, [e]);
  }
  const eventBySlug = new Map(events.filter((e) => e.year === year).map((e) => [e.slug, e]));

  // Cohorts pool every season, so a level that got weaker overall shows up as
  // every event in it scoring lower rather than being re-centred away.
  const cohorts = buildCohorts(observations.map((o) => ({ level: o.level, cut: o.daCut })));

  const bySlugYear = new Map<string, (typeof observations)[number]>();
  for (const o of observations) bySlugYear.set(`${o.slug}:${o.year}`, o);

  const unscored = new Set<string>();
  const rows: StrengthRow[] = [];

  // Iterate the CALENDAR, not the cut list. An event that has not been played
  // yet has no cut, and those are exactly the ones a player is deciding about,
  // so they must appear with a projection rather than be filtered out.
  for (const event of eventBySlug.values()) {
    if (!isScorableLevel(event.level)) continue;

    const actual = bySlugYear.get(`${event.slug}:${year}`);
    const projected = projections.get(event.slug);
    const cohort = cohorts.get(event.level) ?? [];

    let cut: number | null = null;
    let score: number | null = null;
    let scoreLow: number | null = null;
    let scoreHigh: number | null = null;
    let basis: StrengthBasis | null = null;

    if (actual?.daCut != null) {
      cut = actual.daCut;
      score = strengthScore(cut, cohort);
      basis = 'actual';
    } else if (projected) {
      cut = projected.cut;
      score = strengthScore(projected.cut, cohort);
      // A higher cut is a weaker field, so the projection's high cut bound is
      // the LOW end of the strength range. Swapping these would invert the bar.
      scoreLow = strengthScore(projected.high, cohort);
      scoreHigh = strengthScore(projected.low, cohort);
      basis = 'projected';
    }
    if (score == null && cut != null) unscored.add(event.level);

    const prior = bySlugYear.get(`${event.slug}:${year - 1}`);
    const priorCohort = prior ? (cohorts.get(prior.level) ?? []) : [];
    const priorScore = prior?.daCut != null ? strengthScore(prior.daCut, priorCohort) : null;
    const delta = score != null && priorScore != null ? score - priorScore : null;

    const itf = itfNearby(event, byWeek.get(event.week) ?? []);

    rows.push({
      slug: event.slug,
      name: event.name,
      week: event.week,
      level: event.level,
      priorLevel: prior?.level ?? null,
      cut,
      priorCut: prior?.daCut ?? null,
      score,
      priorScore,
      delta,
      band: delta != null ? strengthBand(delta) : null,
      levelChanged: prior != null && prior.level !== event.level,
      basis,
      scoreLow,
      scoreHigh,
      itf,
      itfNote: itfNote(itf),
    });
  }

  rows.sort((a, b) => a.week - b.week || a.name.localeCompare(b.name));

  // Measured rows only: including projections would let the model's own
  // tendencies set the baseline everything else is read against.
  const deltas = rows
    .filter((r) => r.basis === 'actual')
    .map((r) => r.delta)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const seasonMedianDelta = deltas.length
    ? deltas.length % 2
      ? deltas[(deltas.length - 1) / 2]
      : Math.round((deltas[deltas.length / 2 - 1] + deltas[deltas.length / 2]) / 2)
    : null;

  return {
    year,
    discipline,
    drawType,
    rows,
    unscoredLevels: [...unscored].sort(),
    seasonMedianDelta,
    counts: {
      total: rows.length,
      scored: rows.filter((r) => r.score != null).length,
      compared: rows.filter((r) => r.delta != null).length,
      projected: rows.filter((r) => r.basis === 'projected').length,
    },
  };
}

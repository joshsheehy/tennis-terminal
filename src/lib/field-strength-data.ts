// Year-over-year field strength for every scorable event in a season.
//
// Reads the cuts already stored in cutoff_snapshots via loadDepthObservations
// and scores them; nothing is fetched or recomputed.

import type { Pool } from 'pg';
import { loadDepthObservations } from './depth-data';
import type { Discipline } from './depth';
import {
  buildCohorts,
  isScorableLevel,
  strengthBand,
  strengthScore,
  type StrengthBand,
} from './field-strength';

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
};

export type StrengthView = {
  year: number;
  discipline: Discipline;
  drawType: 'main' | 'qualifying';
  rows: StrengthRow[];
  /** Levels with too few recorded cuts to score against. */
  unscoredLevels: string[];
  counts: { total: number; scored: number; compared: number };
};

export async function buildStrengthView(
  pool: Pool,
  year: number,
  discipline: Discipline,
  drawType: 'main' | 'qualifying' = 'main'
): Promise<StrengthView> {
  const observations = await loadDepthObservations(pool, discipline, drawType);

  // Cohorts pool every season, so a level that got weaker overall shows up as
  // every event in it scoring lower rather than being re-centred away.
  const cohorts = buildCohorts(observations.map((o) => ({ level: o.level, cut: o.daCut })));

  const bySlugYear = new Map<string, (typeof observations)[number]>();
  for (const o of observations) bySlugYear.set(`${o.slug}:${o.year}`, o);

  const unscored = new Set<string>();
  const rows: StrengthRow[] = [];

  for (const o of observations) {
    if (o.year !== year || !isScorableLevel(o.level)) continue;

    const cohort = cohorts.get(o.level) ?? [];
    const score = o.daCut != null ? strengthScore(o.daCut, cohort) : null;
    if (score == null && o.daCut != null) unscored.add(o.level);

    const prior = bySlugYear.get(`${o.slug}:${year - 1}`);
    const priorCohort = prior ? (cohorts.get(prior.level) ?? []) : [];
    const priorScore =
      prior?.daCut != null ? strengthScore(prior.daCut, priorCohort) : null;

    const delta = score != null && priorScore != null ? score - priorScore : null;

    rows.push({
      slug: o.slug,
      name: o.name,
      week: o.week,
      level: o.level,
      priorLevel: prior?.level ?? null,
      cut: o.daCut,
      priorCut: prior?.daCut ?? null,
      score,
      priorScore,
      delta,
      band: delta != null ? strengthBand(delta) : null,
      levelChanged: prior != null && prior.level !== o.level,
    });
  }

  rows.sort((a, b) => a.week - b.week || a.name.localeCompare(b.name));

  return {
    year,
    discipline,
    drawType,
    rows,
    unscoredLevels: [...unscored].sort(),
    counts: {
      total: rows.length,
      scored: rows.filter((r) => r.score != null).length,
      compared: rows.filter((r) => r.delta != null).length,
    },
  };
}

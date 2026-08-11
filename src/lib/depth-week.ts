// The human-readable side of competitive depth: for one week, group events into
// the regions that actually compete for the same players and rank them from
// easiest to hardest to get into.
//
// This is deliberately the ONLY claim the validation supports. V1 showed depth
// reproduces the within-week ordering of observed cuts (Spearman +0.32 singles
// / +0.29 doubles, 74-81% of pairs ordered correctly). V5 showed that year-over
// -year Δdepth does NOT predict how a cut moves — it was ~8% worse than reusing
// last year's number. So this ranks events against EACH OTHER inside one week,
// and never claims a cut will be tougher or easier than last year's.
//
// Last year's cut is shown beside the ranking as a factual anchor, read from
// the cuts already stored in cutoff_snapshots. Nothing is re-fetched.

import type { Pool } from 'pg';
import { haversineKm } from './cut-prediction';
import { computeDepth, sameWeekScope, type DepthEvent, type Discipline } from './depth';
import { loadDepthEvents, loadDepthObservations } from './depth-data';

/** Same regional radius the validation clustered on. */
export const REGION_KM = 1500;

export type WeekEntry = {
  slug: string;
  name: string;
  level: string;
  surface: string;
  indoor: boolean | null;
  /** Acceptance places within reach at this level or better, including its own.
   * Displayed rounded — it is an estimate built from per-level draw sizes. */
  spotsNearby: number;
  ownSlots: number;
  /** Plain-language reasons, biggest contributor first. */
  reasons: string[];
  /** How many events at or above this one sit within reach. */
  competingEvents: number;
  lastYearCut: number | null;
  lastYearLevel: string | null;
  thisYearCut: number | null;
};

export type WeekRegion = {
  label: string;
  entries: WeekEntry[];
};

export type WeekView = {
  year: number;
  week: number;
  discipline: Discipline;
  unit: 'places' | 'team places';
  regions: WeekRegion[];
  /** Weeks that have any events at all, for the picker. */
  availableWeeks: number[];
};

function hoursAway(km: number): string {
  if (km < 150) return 'next door';
  if (km < 400) return 'a short hop';
  if (km < 1000) return 'a short flight';
  return 'a long flight';
}

/** Greedy single-link clustering, same approach the validator uses. */
function clusterEvents(events: DepthEvent[]): DepthEvent[][] {
  const unassigned = events.filter((e) => e.latitude != null && e.longitude != null);
  const clusters: DepthEvent[][] = [];
  while (unassigned.length > 0) {
    const cluster = [unassigned.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = unassigned.length - 1; i >= 0; i--) {
        const c = unassigned[i];
        if (
          cluster.some(
            (m) => haversineKm(m.latitude!, m.longitude!, c.latitude!, c.longitude!) <= REGION_KM
          )
        ) {
          cluster.push(c);
          unassigned.splice(i, 1);
          grew = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** Rough continent label from a centroid, so regions read as places rather
 * than as cluster numbers. */
function regionLabel(cluster: DepthEvent[]): string {
  const lat = cluster.reduce((a, e) => a + e.latitude!, 0) / cluster.length;
  const lon = cluster.reduce((a, e) => a + e.longitude!, 0) / cluster.length;
  if (lon >= -30 && lon <= 45 && lat >= 34) return 'Europe';
  if (lon >= -20 && lon <= 55 && lat < 34 && lat > -40) return 'Africa & Middle East';
  if (lon > 45 && lon <= 150 && lat >= 5) return 'Asia';
  if (lon > 100 && lat < 5) return 'Oceania';
  if (lon < -30 && lat >= 15) return 'North America';
  if (lon < -30 && lat < 15) return 'South America';
  return 'Elsewhere';
}

export async function buildWeekView(
  pool: Pool,
  year: number,
  week: number,
  discipline: Discipline
): Promise<WeekView> {
  const events = await loadDepthEvents(pool);
  const observations = await loadDepthObservations(pool, discipline, 'main');

  // Cuts already stored — keyed by slug+year so last season's number is a
  // lookup, not a fetch.
  const cutBySlugYear = new Map<string, number>();
  const levelBySlugYear = new Map<string, string>();
  for (const o of observations) {
    if (o.daCut != null) cutBySlugYear.set(`${o.slug}:${o.year}`, o.daCut);
    levelBySlugYear.set(`${o.slug}:${o.year}`, o.level);
  }

  const inWeek = events.filter((e) => e.year === year && e.week === week);
  const scope = sameWeekScope(events, year, week);

  const regions: WeekRegion[] = clusterEvents(inWeek)
    .map((cluster) => {
      const entries: WeekEntry[] = cluster.map((e) => {
        const d = computeDepth(e, scope, discipline);
        const reasons: string[] = [];
        for (const c of d.contributions.slice(0, 3)) {
          const other = scope.find((s) => s.slug === c.slug);
          const who = other?.name ?? c.slug;
          reasons.push(
            c.kind === 'absorption'
              ? `${who} (${c.level}, ${hoursAway(c.km)}) pulls the strongest players away`
              : `${who} (${c.level}, ${hoursAway(c.km)}) draws from the same pool`
          );
        }
        if (reasons.length === 0) {
          reasons.push('Nothing at this level or above within reach — it has the region to itself');
        }
        return {
          slug: e.slug,
          name: e.name,
          level: e.level,
          surface: e.surface,
          indoor: e.indoor,
          spotsNearby: Math.round(d.depth),
          ownSlots: d.ownSlots,
          reasons,
          competingEvents: d.contributions.length,
          lastYearCut: cutBySlugYear.get(`${e.slug}:${year - 1}`) ?? null,
          lastYearLevel: levelBySlugYear.get(`${e.slug}:${year - 1}`) ?? null,
          thisYearCut: cutBySlugYear.get(`${e.slug}:${year}`) ?? null,
        };
      });

      // More places within reach means the field spreads thinner, so the event
      // is easier to get into. Easiest first.
      entries.sort((a, b) => b.spotsNearby - a.spotsNearby);
      return { label: regionLabel(cluster), entries };
    })
    .filter((r) => r.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length);

  const availableWeeks = [
    ...new Set(events.filter((e) => e.year === year).map((e) => e.week)),
  ].sort((a, b) => a - b);

  return {
    year,
    week,
    discipline,
    unit: discipline === 'doubles' ? 'team places' : 'places',
    regions,
    availableWeeks,
  };
}

// Server-side data for the /swings map view (phase 3). Reuses the cached
// per-year event load, then filters by level scope and computes swings live
// (detection is cheap) so any scope renders correctly on first paint, even a
// combination the nightly job hasn't persisted.

import { unstable_cache } from 'next/cache';
import { pool } from './db';
import { getAtpWeekForSeason } from './atp-week';
import { CURRENT_SEASON } from './seasons';
import {
  DEFAULT_LEVEL_SCOPE,
  DEFAULT_SWING_CONFIG,
  LevelGroup,
  SwingConfig,
  detectSwings,
  levelGroup,
  scopeKey,
} from './swings';
import { loadSwingEventsForYear } from './swings-data';
import type { TournamentCutRefs } from './swing-rank-check';

export type SwingMapEvent = {
  editionId: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  week: number;
  startDate: string;
  level: string;
  group: LevelGroup;
  surface: string;
  latitude: number;
  longitude: number;
  /** Index into SwingsPageData.swings, or null for a standalone event. */
  swingIndex: number | null;
};

export type SwingMapSwing = {
  index: number;
  kind: 'swing' | 'series';
  label: string;
  startWeek: number;
  endWeek: number;
  totalWeeks: number;
  surfaceConsistent: boolean;
  surfaces: string[];
  tierMix: string;
  countries: string[];
  editionIds: string[];
  /** One representative coordinate per week, week-ordered, for the polyline. */
  path: Array<{ week: number; lat: number; lng: number }>;
  /** Per-week itinerary for the bottom sheet. */
  itinerary: Array<{
    week: number;
    events: Array<{ slug: string; name: string; city: string; level: string; surface: string }>;
  }>;
};

export type SwingsPageData = {
  year: number;
  scope: string;
  groups: LevelGroup[];
  currentWeek: number;
  events: SwingMapEvent[];
  swings: SwingMapSwing[];
  /** Most recent historical singles + doubles cuts per tournament slug, for
   * the rank check (2026 stops reference the prior year's cut). */
  cutRefs: Record<string, TournamentCutRefs>;
  /** Cut per year (post-alternates where recorded) for each draw the info
   * popover can show, keyed by slug — compact [year, cut] tuples with short
   * draw keys (m = singles main, q = singles qualifying, d = doubles main)
   * to keep the RSC payload small. */
  cutSeries: Record<string, CutSeriesByDraw>;
};

export type CutSeriesByDraw = {
  m?: Array<[number, number]>;
  q?: Array<[number, number]>;
  d?: Array<[number, number]>;
};

const getCachedEvents = unstable_cache(
  async (year: number) => loadSwingEventsForYear(pool, year),
  ['swings-events'],
  { revalidate: 300 }
);

// Most recent historical singles + doubles cuts per tournament that holds an
// edition in `year`. distinct on (slug, event_type, draw_type) ordered by year
// desc -> latest cut per draw. Doubles cuts come from either the ATP-style
// direct-acceptance rank or the Challenger doubles "advanced entry" team cut.
async function loadReferenceCutoffs(year: number): Promise<Record<string, TournamentCutRefs>> {
  const result = await pool.query<{
    slug: string;
    from_year: number;
    event_type: 'singles' | 'doubles';
    draw_type: 'main' | 'qualifying';
    direct: number | null;
    alt: number | null;
    dbl_adv: number | null;
    dbl_onsite: number | null;
  }>(
    `
    with relevant as (
      select distinct t.id, t.slug
      from tournaments t
      join tournament_editions te on te.tournament_id = t.id
      where te.status = 'held' and te.year = $1
    )
    select distinct on (r.slug, cs.event_type, cs.draw_type)
      r.slug,
      te.year as from_year,
      cs.event_type,
      cs.draw_type,
      cs.last_direct_acceptance_rank as direct,
      cs.last_alternate_rank as alt,
      cs.challenger_doubles_advanced_cut_rank as dbl_adv,
      cs.challenger_doubles_onsite_cut_rank as dbl_onsite
    from relevant r
    join tournament_editions te on te.tournament_id = r.id
    join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where cs.last_direct_acceptance_rank is not null
       or cs.challenger_doubles_advanced_cut_rank is not null
    order by r.slug, cs.event_type, cs.draw_type, te.year desc
    `,
    [year]
  );

  const emptyRefs = (): TournamentCutRefs => ({
    singles: { mainCut: null, mainAlt: null, qualCut: null, fromYear: null },
    doubles: { mainCut: null, mainAlt: null, qualCut: null, fromYear: null },
  });

  const refs: Record<string, TournamentCutRefs> = {};
  for (const row of result.rows) {
    const entry = refs[row.slug] ?? emptyRefs();
    const ref = row.event_type === 'doubles' ? entry.doubles : entry.singles;
    if (row.draw_type === 'main') {
      if (row.event_type === 'doubles') {
        // ATP doubles use the direct rank; Challenger doubles the advanced cut.
        ref.mainCut = row.direct ?? row.dbl_adv;
        ref.mainAlt = row.dbl_onsite ?? row.alt;
      } else {
        ref.mainCut = row.direct;
        ref.mainAlt = row.alt;
      }
    } else {
      ref.qualCut = row.direct;
    }
    ref.fromYear = Math.max(ref.fromYear ?? 0, row.from_year) || row.from_year;
    refs[row.slug] = entry;
  }
  return refs;
}

const getCachedCutRefs = unstable_cache(
  async (year: number) => loadReferenceCutoffs(year),
  ['swings-cutrefs'],
  { revalidate: 300 }
);

// Cut per year and draw for every tournament holding an edition in `year` —
// the builder's info popover draws its mini cut lines from this. Three draws:
// singles main, singles qualifying, doubles main (same rank precedence as the
// tournament page's trend chart). Compact tuples keep the RSC payload small.
async function loadCutSeries(year: number): Promise<Record<string, CutSeriesByDraw>> {
  const result = await pool.query<{
    slug: string;
    year: number;
    event_type: 'singles' | 'doubles';
    draw_type: 'main' | 'qualifying';
    cut: number | null;
  }>(
    `
    with relevant as (
      select distinct t.id, t.slug
      from tournaments t
      join tournament_editions te on te.tournament_id = t.id
      where te.status = 'held' and te.year = $1
    )
    select
      r.slug,
      te.year,
      cs.event_type,
      cs.draw_type,
      case
        when cs.event_type = 'doubles'
          then coalesce(cs.challenger_doubles_advanced_cut_rank, cs.last_alternate_rank, cs.last_direct_acceptance_rank)
        else coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank)
      end as cut
    from relevant r
    join tournament_editions te on te.tournament_id = r.id
    join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where cs.draw_type = 'main' or cs.event_type = 'singles'
    order by r.slug, te.year
    `,
    [year]
  );
  const series: Record<string, CutSeriesByDraw> = {};
  for (const row of result.rows) {
    if (row.cut == null) continue;
    const drawKey: keyof CutSeriesByDraw =
      row.event_type === 'doubles' ? 'd' : row.draw_type === 'qualifying' ? 'q' : 'm';
    const entry = (series[row.slug] ??= {});
    (entry[drawKey] ??= []).push([row.year, row.cut]);
  }
  return series;
}

// Key versioned: the disk-persisted fetch cache survives deploys, and the
// entry shape changed from a bare tuple array to per-draw keys.
const getCachedCutSeries = unstable_cache(
  async (year: number) => loadCutSeries(year),
  ['swings-cutseries-v2'],
  { revalidate: 300 }
);

export async function getSwingsPageData(
  year: number,
  groups: LevelGroup[] = DEFAULT_LEVEL_SCOPE,
  config: SwingConfig = DEFAULT_SWING_CONFIG
): Promise<SwingsPageData> {
  const [all, cutRefs, cutSeries] = await Promise.all([getCachedEvents(year), getCachedCutRefs(year), getCachedCutSeries(year)]);
  const groupSet = new Set(groups);
  const scoped = all.filter((e) => {
    const g = levelGroup(e.level);
    return g !== null && groupSet.has(g);
  });

  const detected = detectSwings(scoped, config);

  // Map each member edition to its swing index for quick dot styling.
  const swingIndexByEdition = new Map<string, number>();
  detected.forEach((swing, index) => {
    for (const week of swing.weeks) {
      for (const event of week.events) swingIndexByEdition.set(event.editionId, index);
    }
  });

  const events: SwingMapEvent[] = scoped
    .filter((e) => e.latitude != null && e.longitude != null)
    .map((e) => ({
      editionId: e.editionId,
      slug: e.slug,
      name: e.name,
      city: e.city,
      country: e.country,
      week: e.week,
      startDate: e.startDate,
      level: e.level,
      group: levelGroup(e.level)!,
      surface: e.surface,
      latitude: e.latitude!,
      longitude: e.longitude!,
      swingIndex: swingIndexByEdition.get(e.editionId) ?? null,
    }));

  const swings: SwingMapSwing[] = detected.map((swing, index) => {
    const path: SwingMapSwing['path'] = [];
    for (const week of swing.weeks) {
      // Representative point: first coordinate-bearing event of the week.
      const located = week.events.find((e) => e.latitude != null && e.longitude != null);
      if (located) path.push({ week: week.week, lat: located.latitude!, lng: located.longitude! });
    }
    return {
      index,
      kind: swing.kind,
      label: swing.label,
      startWeek: swing.startWeek,
      endWeek: swing.endWeek,
      totalWeeks: swing.totalWeeks,
      surfaceConsistent: swing.surfaceConsistent,
      surfaces: swing.surfaces,
      tierMix: swing.tierMix,
      countries: swing.countries,
      editionIds: swing.weeks.flatMap((w) => w.events.map((e) => e.editionId)),
      path,
      itinerary: swing.weeks.map((week) => ({
        week: week.week,
        events: week.events.map((e) => ({
          slug: e.slug,
          name: e.name,
          city: e.city,
          level: e.level,
          surface: e.surface,
        })),
      })),
    };
  });

  const currentWeek =
    year === CURRENT_SEASON ? getAtpWeekForSeason(new Date(), year) ?? 1 : 1;

  return { year, scope: scopeKey(groups), groups, currentWeek, events, swings, cutRefs, cutSeries };
}

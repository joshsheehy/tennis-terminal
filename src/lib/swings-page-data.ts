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
};

const getCachedEvents = unstable_cache(
  async (year: number) => loadSwingEventsForYear(pool, year),
  ['swings-events'],
  { revalidate: 300 }
);

export async function getSwingsPageData(
  year: number,
  groups: LevelGroup[] = DEFAULT_LEVEL_SCOPE,
  config: SwingConfig = DEFAULT_SWING_CONFIG
): Promise<SwingsPageData> {
  const all = await getCachedEvents(year);
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

  return { year, scope: scopeKey(groups), groups, currentWeek, events, swings };
}

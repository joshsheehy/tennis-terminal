// Single source of truth for which ATP seasons the app serves.
// Bump CURRENT_SEASON (and extend AVAILABLE_SEASONS) once each January —
// previously these values were hardcoded in four separate files.

export const CURRENT_SEASON = 2026;

// 2027 shows up here before the January bump because of the ATP's own
// season-year convention: a handful of early-December Challengers each year
// count toward next year's tour season, so their tournament_editions.year is
// already 2027 the moment the official calendar sync imports them (see
// getAtpEditionYearForStartDate). Leaving 2027 out of this list until January
// didn't stop them from being imported — they were already in the DB — it
// just made them invisible everywhere (cuts page, swings builder, schedule),
// which read as "the calendar importer can't find December" when the real
// problem was display-only.
/** Seasons with imported data, newest first (display order for the picker). */
export const AVAILABLE_SEASONS: readonly number[] = [2027, 2026, 2025, 2024, 2023, 2022];

export const EARLIEST_SEASON = Math.min(...AVAILABLE_SEASONS);

export function isAvailableSeason(year: number): boolean {
  return AVAILABLE_SEASONS.includes(year);
}

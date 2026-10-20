// Single source of truth for which ATP seasons the app serves.
// Bump CURRENT_SEASON (and extend AVAILABLE_SEASONS) once each January —
// previously these values were hardcoded in four separate files.

export const CURRENT_SEASON = 2026;

// 2027 is listed ahead of the January bump so next season's calendar is
// visible the moment the nightly sync imports it. (It used to be here because
// early-December Challengers were filed as 2027 week 1; they are 2026 weeks
// 49-51 -- see getAtpEditionYearForStartDate.)
/** Seasons with imported data, newest first (display order for the picker). */
export const AVAILABLE_SEASONS: readonly number[] = [2027, 2026, 2025, 2024, 2023, 2022];

export const EARLIEST_SEASON = Math.min(...AVAILABLE_SEASONS);

export function isAvailableSeason(year: number): boolean {
  return AVAILABLE_SEASONS.includes(year);
}

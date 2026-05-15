const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseUtcDateOnly(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

// Week 1 Monday of the ATP season.
// Rule: if Jan 1 is Mon/Tue/Wed, season starts on the Monday on or before Jan 1
// (so 2024 Jan 1 Mon -> Jan 1, 2025 Jan 1 Wed -> Dec 30, 2024).
// If Jan 1 is Thu/Fri/Sat/Sun, season starts on the Monday after Jan 1
// (so 2026 Jan 1 Thu -> Jan 5, 2026). Anything that starts before that Monday
// is clamped to week 1 by getAtpWeekForSeason.
export function getAtpSeasonStartDateUtc(seasonYear: number): Date {
  const jan1 = new Date(Date.UTC(seasonYear, 0, 1));
  const day = jan1.getUTCDay();
  const isoDow = day === 0 ? 7 : day;
  const offsetDays = isoDow <= 3 ? 1 - isoDow : 8 - isoDow;
  return new Date(jan1.getTime() + offsetDays * MS_PER_DAY);
}

export function getAtpWeekForSeason(
  startDate: string | Date | null,
  seasonYear: number
): number | null {
  if (!startDate) return null;

  const start = parseUtcDateOnly(startDate);
  if (!start) return null;

  const seasonStart = getAtpSeasonStartDateUtc(seasonYear);
  const diffDays = Math.floor((start.getTime() - seasonStart.getTime()) / MS_PER_DAY);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

export function getAtpEditionYearForStartDate(
  startDate: string | Date,
  requestedYear: number
): number {
  const parsed = parseUtcDateOnly(startDate);
  if (!parsed) return requestedYear;
  return parsed.getUTCMonth() === 11 ? parsed.getUTCFullYear() + 1 : requestedYear;
}

// Internal sanity checks for ATP season week rules.
void [
  getAtpWeekForSeason('2024-01-01', 2024) === 1,
  getAtpWeekForSeason('2024-01-08', 2024) === 2,
  getAtpWeekForSeason('2024-12-30', 2025) === 1,
  getAtpWeekForSeason('2025-01-06', 2025) === 2,
  getAtpWeekForSeason('2025-01-13', 2025) === 3,
  getAtpWeekForSeason('2025-12-29', 2026) === 1,
  getAtpWeekForSeason('2026-01-05', 2026) === 1,
  getAtpWeekForSeason('2026-01-12', 2026) === 2,
];

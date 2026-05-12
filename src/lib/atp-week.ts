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

export function getAtpSeasonStartDateUtc(seasonYear: number): Date {
  const jan1 = new Date(Date.UTC(seasonYear, 0, 1));
  const day = jan1.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  return new Date(jan1.getTime() - daysBack * MS_PER_DAY);
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
  getAtpWeekForSeason('2024-12-30', 2025) === 1,
  getAtpWeekForSeason('2025-01-06', 2025) === 2,
  getAtpWeekForSeason('2025-01-13', 2025) === 3,
  getAtpWeekForSeason('2024-01-01', 2024) === 1,
  getAtpWeekForSeason('2024-01-08', 2024) === 2,
];

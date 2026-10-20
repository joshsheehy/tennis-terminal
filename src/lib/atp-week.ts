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

// The ATP season a start date belongs to, decided by the date alone.
//
// Only the single week immediately before next season's Week 1 Monday (the
// Dec 29/30 "week 1 carryover" events) counts toward next season. Everything
// else in December -- the Dec 7 and Dec 14 Challengers -- is THIS season's
// weeks 49-51. This used to bump every December date to year + 1, which filed
// those events under week 1 of next January, and gave a tournament played both
// in December and in next year's calendar two rows fighting over one
// (tournament, year) slot, so they kept overwriting each other night to night.
//
// requestedYear is only a fallback for an unparseable date: a row's own date is
// the truth, so a January row read out of a two-season PDF can never land on
// (and overwrite) the requested season's edition of the same tournament.
export function getAtpEditionYearForStartDate(
  startDate: string | Date,
  requestedYear: number
): number {
  const parsed = parseUtcDateOnly(startDate);
  if (!parsed) return requestedYear;
  const calendarYear = parsed.getUTCFullYear();
  const nextSeasonStart = getAtpSeasonStartDateUtc(calendarYear + 1);
  return parsed.getTime() >= nextSeasonStart.getTime() - 7 * MS_PER_DAY ? calendarYear + 1 : calendarYear;
}

// SQL twins of the two functions above, so every query decides "which season
// is this date in" exactly the way the importers do. getAtpSeasonStartDateUtc's
// rule is the Monday of the week containing Jan 5.
export const ATP_SEASON_START_SQL = (yearExpr: string) =>
  `(date_trunc('week', make_date((${yearExpr})::int, 1, 5))::date)`;

export const ATP_SEASON_FOR_DATE_SQL = (dateExpr: string) =>
  `(extract(year from ${dateExpr})::int + case when ${dateExpr} >= ${ATP_SEASON_START_SQL(
    `extract(year from ${dateExpr})::int + 1`
  )} - 7 then 1 else 0 end)`;

/** True when an edition's start_date belongs to the season in its year column. */
export const EDITION_IN_ITS_SEASON_SQL = (alias = 'te') =>
  `(${ATP_SEASON_FOR_DATE_SQL(`${alias}.start_date`)} = ${alias}.year)`;

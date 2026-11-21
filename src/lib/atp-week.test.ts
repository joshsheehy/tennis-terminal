import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATP_SEASON_START_SQL,
  ATP_WEEK_SQL,
  getAtpEditionYearForStartDate,
  getAtpSeasonStartDateUtc,
  getAtpWeekForSeason,
} from './atp-week';

// These cases previously lived in atp-week.ts as a `void [...]` block that
// computed booleans and threw them away — they asserted nothing.

describe('getAtpSeasonStartDateUtc', () => {
  it('rolls back to Monday on/before Jan 1 when Jan 1 is Mon-Wed', () => {
    expect(getAtpSeasonStartDateUtc(2024).toISOString().slice(0, 10)).toBe('2024-01-01'); // Mon
    expect(getAtpSeasonStartDateUtc(2025).toISOString().slice(0, 10)).toBe('2024-12-30'); // Jan 1 is Wed
  });

  it('rolls forward to the next Monday when Jan 1 is Thu-Sun', () => {
    expect(getAtpSeasonStartDateUtc(2026).toISOString().slice(0, 10)).toBe('2026-01-05'); // Jan 1 is Thu
  });
});

describe('getAtpWeekForSeason', () => {
  it('matches the ATP week rule across seasons', () => {
    expect(getAtpWeekForSeason('2024-01-01', 2024)).toBe(1);
    expect(getAtpWeekForSeason('2024-01-08', 2024)).toBe(2);
    expect(getAtpWeekForSeason('2024-12-30', 2025)).toBe(1);
    expect(getAtpWeekForSeason('2025-01-06', 2025)).toBe(2);
    expect(getAtpWeekForSeason('2025-01-13', 2025)).toBe(3);
    expect(getAtpWeekForSeason('2025-12-29', 2026)).toBe(1);
    expect(getAtpWeekForSeason('2026-01-05', 2026)).toBe(1);
    expect(getAtpWeekForSeason('2026-01-12', 2026)).toBe(2);
  });

  it('clamps pre-season starts to week 1', () => {
    expect(getAtpWeekForSeason('2026-01-01', 2026)).toBe(1);
  });

  it('returns null for missing or invalid dates', () => {
    expect(getAtpWeekForSeason(null, 2026)).toBeNull();
    expect(getAtpWeekForSeason('not-a-date', 2026)).toBeNull();
  });
});

describe('getAtpEditionYearForStartDate', () => {
  it('assigns only the week right before next season\'s Week 1 to the following season', () => {
    expect(getAtpEditionYearForStartDate('2025-12-29', 2025)).toBe(2026);
    expect(getAtpEditionYearForStartDate('2026-12-28', 2026)).toBe(2027);
    expect(getAtpEditionYearForStartDate('2024-12-30', 2024)).toBe(2025);
  });

  it('keeps early-December starts in the season they are played in', () => {
    expect(getAtpEditionYearForStartDate('2026-12-07', 2026)).toBe(2026);
    expect(getAtpEditionYearForStartDate('2026-12-14', 2026)).toBe(2026);
    expect(getAtpEditionYearForStartDate('2026-12-21', 2026)).toBe(2026);
    expect(getAtpEditionYearForStartDate('2025-12-01', 2025)).toBe(2025);
    expect(getAtpWeekForSeason('2026-12-07', 2026)).toBe(49);
    expect(getAtpWeekForSeason('2026-12-14', 2026)).toBe(50);
  });

  it('goes by the date, not the requested year', () => {
    expect(getAtpEditionYearForStartDate('2026-01-05', 2026)).toBe(2026);
    expect(getAtpEditionYearForStartDate('2027-01-11', 2026)).toBe(2027);
    expect(getAtpEditionYearForStartDate('not-a-date', 2026)).toBe(2026);
  });
});

describe('2027 season (Jan 1 is a Friday)', () => {
  it('puts Week 1 on Mon Jan 4, not the Monday before Jan 1', () => {
    expect(getAtpSeasonStartDateUtc(2027).toISOString().slice(0, 10)).toBe('2027-01-04');
    expect(getAtpWeekForSeason('2026-12-28', 2027)).toBe(1); // carryover week
    expect(getAtpWeekForSeason('2027-01-04', 2027)).toBe(1);
    expect(getAtpWeekForSeason('2027-01-11', 2027)).toBe(2);
    expect(getAtpWeekForSeason('2027-01-18', 2027)).toBe(3);
    expect(getAtpWeekForSeason('2027-01-25', 2027)).toBe(4);
  });
});

describe('SQL twins', () => {
  // ATP_SEASON_START_SQL computes "the Monday of the week containing Jan 5".
  // It has to land on the same day as getAtpSeasonStartDateUtc every year.
  it('season start: Monday of the week containing Jan 5 matches the TS rule', () => {
    for (let year = 2018; year <= 2040; year++) {
      const jan5 = new Date(Date.UTC(year, 0, 5));
      const isoDow = jan5.getUTCDay() === 0 ? 7 : jan5.getUTCDay();
      const monday = new Date(jan5.getTime() - (isoDow - 1) * 24 * 60 * 60 * 1000);
      expect(monday.toISOString().slice(0, 10), String(year)).toBe(
        getAtpSeasonStartDateUtc(year).toISOString().slice(0, 10)
      );
    }
  });

  it('ATP_WEEK_SQL is built on ATP_SEASON_START_SQL', () => {
    expect(ATP_WEEK_SQL('te.start_date', 'te.year')).toBe(
      `greatest(1, ((te.start_date)::date - ${ATP_SEASON_START_SQL('te.year')}) / 7 + 1)`
    );
  });

  // The old "Monday on/before Jan 1" arithmetic stored every January 2027
  // edition one week late (C7 in the Monday audit). Keep it from coming back.
  it('no route recomputes week with the stale Monday-of-Jan-1 rule', () => {
    const stale = /date_trunc\('week',\s*make_date\([^)]*,\s*1,\s*1\)\)/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && stale.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(join(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
});

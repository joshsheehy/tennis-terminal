import { describe, expect, it } from 'vitest';
import {
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

import { describe, expect, it } from 'vitest';
import { ALL_EDITIONS, ATP_TOUR_CALENDAR_2027_URL, catalogueEntryForCode } from './tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from './atp-week';

const TOUR_LEVEL = /^(ATP (250|500|1000)|Grand Slam( Qualifying)?)$/;

const rowsFor = (year: number) => ALL_EDITIONS.filter((e) => e.edition.year === year);
const tourSlugs = (year: number) =>
  new Set(rowsFor(year).filter((e) => TOUR_LEVEL.test(e.edition.level)).map((e) => e.tournament.slug));

describe('2027 ATP Tour calendar', () => {
  const rows2027 = rowsFor(2027);

  it('lists every 2026 tour-level event under the same slug', () => {
    // Same slug = same tournament row, so past cuts stay attached.
    const missing = [...tourSlugs(2026)].filter((slug) => !tourSlugs(2027).has(slug));
    expect(missing).toEqual([]);
  });

  it('adds no tournament that has no earlier season', () => {
    const earlier = new Set(ALL_EDITIONS.filter((e) => e.edition.year < 2027).map((e) => e.tournament.slug));
    expect(rows2027.filter((e) => !earlier.has(e.tournament.slug)).map((e) => e.tournament.slug)).toEqual([]);
  });

  it('has one row per tournament', () => {
    const slugs = rows2027.map((e) => e.tournament.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('files every row in the 2027 season at the week its start date falls in', () => {
    for (const e of rows2027) {
      expect(getAtpEditionYearForStartDate(e.edition.start_date, 2027), e.tournament.slug).toBe(2027);
      expect(getAtpWeekForSeason(e.edition.start_date, 2027), e.tournament.slug).toBe(e.edition.week);
    }
  });

  it('keeps each tournament on its 2026 code and level', () => {
    for (const e of rows2027) {
      const prior = ALL_EDITIONS.find((p) => p.edition.year === 2026 && p.tournament.slug === e.tournament.slug);
      expect(prior, e.tournament.slug).toBeDefined();
      expect(e.edition.protennislive_code, e.tournament.slug).toBe(prior!.edition.protennislive_code);
      expect(e.edition.level, e.tournament.slug).toBe(prior!.edition.level);
    }
  });

  it('cites the published 2027 calendar', () => {
    for (const e of rows2027) expect(e.edition.source_url).toBe(ATP_TOUR_CALENDAR_2027_URL);
  });
});

describe('catalogueEntryForCode', () => {
  it("returns the requested season's row when there is one", () => {
    expect(catalogueEntryForCode(339, 2026)?.edition.start_date).toBe('2026-01-05');
    expect(catalogueEntryForCode(339, 2027)?.edition.start_date).toBe('2027-01-04');
  });

  it('falls back to the closest earlier season, then the earliest later one', () => {
    // Brisbane: 2026 and 2027 rows only.
    expect(catalogueEntryForCode(339, 2028)?.edition.year).toBe(2027);
    expect(catalogueEntryForCode(339, 2025)?.edition.year).toBe(2026);
  });

  it('returns undefined for an unknown code', () => {
    expect(catalogueEntryForCode(999999, 2026)).toBeUndefined();
  });
});

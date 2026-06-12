import { describe, expect, it } from 'vitest';
import {
  buildItfCalendarUrl,
  isParseFailure,
  parseItfCalendarItem,
  parseItfCalendarResponse,
} from './itf-calendar';

const monastir = {
  tournamentKey: 'abc-123',
  tournamentName: 'M15 Monastir',
  tournamentLink: '/en/tournament/m15-monastir/tun/2026/m-itf-tun-2026-042/',
  startDate: '2026-06-15T00:00:00',
  endDate: '2026-06-21T00:00:00',
  location: 'Monastir',
  hostNation: 'Tunisia',
  surfaceDesc: 'Hard',
  category: 'M15',
};

describe('parseItfCalendarItem', () => {
  it('parses a standard men\'s 15K item', () => {
    const result = parseItfCalendarItem(monastir, 2026);
    if (isParseFailure(result)) throw new Error(result.reason);
    expect(result.slug).toBe('itf-m15-monastir-2026-06-15');
    expect(result.name).toBe('M15 Monastir');
    expect(result.city).toBe('Monastir');
    expect(result.country).toBe('Tunisia');
    expect(result.level).toBe('ITF M15');
    expect(result.surface).toBe('Hard');
    expect(result.indoor).toBe(false);
    expect(result.start_date).toBe('2026-06-15');
    expect(result.end_date).toBe('2026-06-21');
    expect(result.week).toBe(24); // 2026 season starts Mon Jan 5
    expect(result.source_url).toBe(
      'https://www.itftennis.com/en/tournament/m15-monastir/tun/2026/m-itf-tun-2026-042/'
    );
  });

  it('tolerates alternate field names, recovers city from the name, splits indoor surfaces', () => {
    const result = parseItfCalendarItem(
      {
        Name: 'M25 Helsinki',
        DateFrom: '2026-02-02',
        DateTo: '2026-02-08',
        NationName: 'Finland',
        Surface: 'Clay - Indoor',
        TournamentCategory: '25',
      },
      2026
    );
    if (isParseFailure(result)) throw new Error(result.reason);
    expect(result.slug).toBe('itf-m25-helsinki-2026-02-02');
    expect(result.city).toBe('Helsinki'); // recovered from "M25 Helsinki"
    expect(result.level).toBe('ITF M25');
    expect(result.surface).toBe('Clay');
    expect(result.indoor).toBe(true);
    expect(result.week).toBe(5);
  });

  it('keeps December events in their own season with end-of-season weeks', () => {
    const result = parseItfCalendarItem(
      { tournamentName: 'M15 Antalya', startDate: '2026-12-14', location: 'Antalya', hostNation: 'Turkey', category: 'M15', surfaceDesc: 'Clay' },
      2026
    );
    if (isParseFailure(result)) throw new Error(result.reason);
    expect(result.year).toBe(2026);
    expect(result.week).toBe(50);
  });

  it('falls back to the name when category fields are missing', () => {
    const result = parseItfCalendarItem(
      { tournamentName: 'M25 Lisbon', startDate: '2026-03-09', hostNation: 'Portugal' },
      2026
    );
    if (isParseFailure(result)) throw new Error(result.reason);
    expect(result.level).toBe('ITF M25');
    expect(result.surface).toBe('Unknown');
  });

  it('accepts late-December season openers as week 1 of the next season', () => {
    // Real case: "M25 Marrakech, 29 Dec to 04 Jan 2026" in the 2026 calendar.
    const result = parseItfCalendarItem(
      { tournamentName: 'M25 Marrakech', startDate: '2025-12-29T00:00:00', location: 'Marrakech', hostNation: 'Morocco', category: 'M25', surfaceDesc: 'Clay' },
      2026
    );
    if (isParseFailure(result)) throw new Error(result.reason);
    expect(result.year).toBe(2026);
    expect(result.week).toBe(1);
    expect(result.start_date).toBe('2025-12-29');
  });

  it('rejects items without a name or with bad/out-of-season dates', () => {
    expect(isParseFailure(parseItfCalendarItem({ startDate: '2026-06-15' }, 2026))).toBe(true);
    expect(isParseFailure(parseItfCalendarItem({ tournamentName: 'M15 X', startDate: 'soon' }, 2026))).toBe(true);
    expect(isParseFailure(parseItfCalendarItem({ tournamentName: 'M15 X', startDate: '2025-12-20' }, 2026))).toBe(true);
    expect(isParseFailure(parseItfCalendarItem({ tournamentName: 'M15 X', startDate: '2027-01-04' }, 2026))).toBe(true);
  });
});

describe('parseItfCalendarResponse', () => {
  it('accepts items/totalItems in any casing and bare arrays', () => {
    expect(parseItfCalendarResponse({ items: [monastir], totalItems: 900 })).toEqual({
      totalItems: 900,
      items: [monastir],
    });
    expect(parseItfCalendarResponse({ Items: [monastir], TotalItems: '900' }).totalItems).toBe(900);
    expect(parseItfCalendarResponse([monastir]).items).toHaveLength(1);
  });

  it('throws a descriptive error on unknown shapes', () => {
    expect(() => parseItfCalendarResponse({ foo: 1 })).toThrow(/Unrecognized ITF calendar response/);
  });
});

describe('buildItfCalendarUrl', () => {
  it('targets the GetCalendar API with the season window and circuit', () => {
    const url = buildItfCalendarUrl(2026, 'MT', 100, 100);
    expect(url).toContain('itftennis.com/tennis/api/TournamentApi/GetCalendar');
    expect(url).toContain('circuitCode=MT');
    expect(url).toContain('dateFrom=2026-01-01');
    expect(url).toContain('dateTo=2026-12-31');
    expect(url).toContain('skip=100');
  });
});

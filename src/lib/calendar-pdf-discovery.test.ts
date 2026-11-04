import { describe, expect, it } from 'vitest';
import {
  CHALLENGER_ROW_PATTERN,
  challengerCalendarUrls,
  discoverChallengerCalendars,
  discoverPlayerZoneCalendars,
  looksLikeChallengerRow,
  playerZoneCalendarUrls,
} from './calendar-pdf-discovery';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const urls = (season: number, iso: string) => challengerCalendarUrls(season, d(iso)).map((c) => c.url);
const CDN = 'https://www.atptour.com/-/media/files/calendar-pdfs';

describe('challengerCalendarUrls', () => {
  it('covers every filename ATP has actually published', () => {
    expect(urls(2026, '2026-01-04')).toContain(`${CDN}/2026/2026-atp-challenger-calendar-as-of-4-january-2026.pdf`);
    expect(urls(2026, '2026-03-10')).toContain(`${CDN}/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf`);
    expect(urls(2027, '2026-10-21')).toContain(`${CDN}/2026/2026-27-atp-challenger-calendar-as-of-21-october-2026.pdf`);
    expect(urls(2027, '2026-10-21')).toContain(`${CDN}/2026/2026-27-atp-challenger-calendar-as-of-21-october-2026-1.pdf`);
  });

  it("looks for next season's calendar in the folder of the year it is published", () => {
    // Published December 2026 → folder 2026, as the 2026 and 2027 Tour calendars were.
    expect(urls(2027, '2026-12-15')).toContain(`${CDN}/2026/2027-atp-challenger-calendar-as-of-15-december-2026.pdf`);
    expect(urls(2027, '2026-12-15')).toContain(`${CDN}/2026/2027-28-atp-challenger-calendar-as-of-15-december-2026.pdf`);
    expect(urls(2027, '2026-12-15')).toContain(`${CDN}/2027/2027-atp-challenger-calendar-as-of-15-december-2026.pdf`);
  });

  it('tries the zero-padded day only when it differs', () => {
    const early = urls(2027, '2026-12-05');
    expect(early).toContain(`${CDN}/2026/2027-atp-challenger-calendar-as-of-5-december-2026.pdf`);
    expect(early).toContain(`${CDN}/2026/2027-atp-challenger-calendar-as-of-05-december-2026.pdf`);
    expect(new Set(urls(2027, '2026-12-15')).size).toBe(urls(2027, '2026-12-15').length);
  });
});

describe('playerZoneCalendarUrls', () => {
  it('checks the season folder and the publish-year folder', () => {
    expect(playerZoneCalendarUrls(2027, d('2026-12-01'))).toEqual([
      'https://rsc.atppz.com/-/media/atp-player-zone/pdf-files/calendars/2027/20261201_2027_combined_calendar.pdf',
      'https://rsc.atppz.com/-/media/atp-player-zone/pdf-files/calendars/2026/20261201_2027_combined_calendar.pdf',
    ]);
  });
});

describe('discovery walk', () => {
  it('returns the newest file per family, newest first', async () => {
    const live = new Set([
      `${CDN}/2026/2026-27-atp-challenger-calendar-as-of-21-october-2026.pdf`,
      `${CDN}/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf`,
      `${CDN}/2026/2027-atp-challenger-calendar-as-of-2-november-2026-updated.pdf`,
    ]);
    const found = await discoverChallengerCalendars({
      season: 2027,
      now: d('2026-11-04'),
      lookBackDays: 250,
      exists: async (u) => live.has(u),
    });
    expect(found).toEqual([
      `${CDN}/2026/2027-atp-challenger-calendar-as-of-2-november-2026-updated.pdf`,
      `${CDN}/2026/2026-27-atp-challenger-calendar-as-of-21-october-2026.pdf`,
    ]);
  });

  it('finds a Player Zone calendar filed under the publish year', async () => {
    const url = 'https://rsc.atppz.com/-/media/atp-player-zone/pdf-files/calendars/2026/20261120_2027_combined_calendar.pdf';
    const found = await discoverPlayerZoneCalendars({
      season: 2027,
      now: d('2026-12-01'),
      exists: async (u) => u === url,
    });
    expect(found).toEqual([url]);
  });
});

describe('CHALLENGER_ROW_PATTERN', () => {
  const parse = (line: string) => CHALLENGER_ROW_PATTERN.exec(line);

  it('reads an indoor-clay row (Maia, 2026)', () => {
    const m = parse('Maia POR 100 EUR 160,680 IC');
    expect(m?.[3]).toBe('Maia');
    expect(m?.[6]).toBe('IC');
  });

  it('reads week/date rows, starred surfaces and notes', () => {
    expect(parse('40 5-Oct Villena ESP 100 EUR 160,680 H')?.slice(1, 7)).toEqual(['40', '5-Oct', 'Villena', 'ESP', '100', 'H']);
    expect(parse('Zug SUI 125 EUR 203,900 C* *CONIUPR TENNIS FORCE')?.[6]).toBe('C'); // the star is a footnote
    expect(parse('Durham, NC USA 50 USD 63,000 H Cancelled')?.[7]).toContain('Cancelled');
    expect(parse('San Salvador ESA 50 USD 63,00 H')?.[3]).toBe('San Salvador');
  });
});

describe('looksLikeChallengerRow', () => {
  it('flags table rows, including ones the pattern rejects', () => {
    expect(looksLikeChallengerRow('Maia POR 100 EUR 160,680 IC')).toBe(true);
    expect(looksLikeChallengerRow('Some Town USA 75 USD 107,000 XX')).toBe(true);
  });

  it('ignores headers, Tour rows and notes', () => {
    expect(looksLikeChallengerRow('50 TBC ATP FINALS NEXT GEN ATP FINALS')).toBe(false);
    expect(looksLikeChallengerRow('Cancelled No ATP Challenger events will be scheduled beyond week 50')).toBe(false);
    expect(looksLikeChallengerRow('Week Date Challenger Tour Country Category Currency Prize Money Surface')).toBe(false);
  });
});

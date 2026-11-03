import { describe, expect, it } from 'vitest';
import { climateWindows, parseSheetConditions, summarizeClimate, weatherLine } from './conditions';

// Site blocks from real 2026 detail sheets, as extractRowText returns them (cells joined by tabs).
const YOKOHAMA = [
  'Keio University Mamushidani Tennis Courts\tSURFACE:\tOutdoor Hard\tLAUNDRY:\tOn-site',
  '4-1-1 Hiyoshi, Kohoku-Ku\tSURFACE BRAND:\tDecoturf\tLAUNDRY COST:\tApprox. US $3.50 (¥500) per bag',
  'Yokohama-Shi 223-0061, Kanagawa\tBALL:\tDunlop AO\tFOOD:\tCatering subcontractor, Buffet style',
].join('\n');
const ANKARA = ['SURFACE:\tLAUNDRY:', 'SURFACE BRAND:\tLAUNDRY COST:', 'BALL:\tFOOD:'].join('\n');
const MONASTIR_2 = [
  'Holiday Village Skanes\tSURFACE:\tOutdoor Hard\tLAUNDRY:\tIn the hotel',
  'Boite Postal Number 2 - Airport Monastir\tSURFACE BRAND:\tGreenset\tLAUNDRY COST:\t€20/bag',
  'BALL:\tFOOD:',
].join('\n');

describe('parseSheetConditions', () => {
  it('reads surface, court brand and ball from the site block', () => {
    expect(parseSheetConditions(YOKOHAMA)).toEqual({ surface: 'Outdoor Hard', courtBrand: 'Decoturf', ball: 'Dunlop AO' });
  });

  it('leaves fields the tournament left blank as null', () => {
    expect(parseSheetConditions(ANKARA)).toEqual({ surface: null, courtBrand: null, ball: null });
    expect(parseSheetConditions(MONASTIR_2)).toEqual({ surface: 'Outdoor Hard', courtBrand: 'Greenset', ball: null });
  });

  it('reads a label and value that arrive as one cell', () => {
    expect(parseSheetConditions('Club\tBALL: Wilson Roland Garros All Court\tFOOD:').ball).toBe('Wilson Roland Garros All Court');
  });
});

describe('climateWindows', () => {
  it('takes the same seven days in each of the five seasons before', () => {
    expect(climateWindows('2026-11-23')).toEqual([
      { start: '2025-11-23', end: '2025-11-29' },
      { start: '2024-11-23', end: '2024-11-29' },
      { start: '2023-11-23', end: '2023-11-29' },
      { start: '2022-11-23', end: '2022-11-29' },
      { start: '2021-11-23', end: '2021-11-29' },
    ]);
  });

  it('keeps a week that runs over New Year as one week', () => {
    expect(climateWindows('2026-12-28', 1)).toEqual([{ start: '2025-12-28', end: '2026-01-03' }]);
  });

  it('maps Feb 29 to Feb 28', () => {
    expect(climateWindows('2028-02-29', 1)).toEqual([{ start: '2027-02-28', end: '2027-03-06' }]);
  });
});

describe('summarizeClimate and weatherLine', () => {
  const day = (high: number, low: number, precipitation: number) => ({ high, low, precipitation, humidity: 80, wind: 20 });

  it('averages the days and counts rainy days per week', () => {
    // Two one-week windows: three rainy days in total → 1.5 a week.
    const days = [...Array(7)].map((_, i) => day(24, 18, i < 2 ? 5 : 0)).concat([...Array(7)].map((_, i) => day(26, 20, i < 1 ? 3 : 0.4)));
    const summary = summarizeClimate(days, 2);
    expect(summary).toEqual({ high: 25, low: 19, rainDays: 1.5, humidity: 80, wind: 20 });
    expect(weatherLine(summary!)).toBe('25° / 19°C · 2 rainy days · 80% humidity · 20 km/h wind');
  });

  it('says "1 rainy day", not "1 rainy days"', () => {
    expect(weatherLine({ high: 29, low: 20, rainDays: 1.4, humidity: 70, wind: 14 })).toBe('29° / 20°C · 1 rainy day · 70% humidity · 14 km/h wind');
  });

  it('has nothing to say without temperatures', () => {
    expect(summarizeClimate([], 5)).toBeNull();
    expect(weatherLine({ high: null, low: null, rainDays: 2, humidity: null, wind: null })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { climateWindows, elevationText, parseSheetConditions, summarizeClimate, weatherLine } from './conditions';
import { joinRows } from './pdf-row-text';

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
    expect(parseSheetConditions(YOKOHAMA)).toEqual({ surface: 'Outdoor Hard', ball: 'Dunlop AO' });
  });

  it('leaves fields the tournament left blank as null', () => {
    expect(parseSheetConditions(ANKARA)).toEqual({ surface: null, ball: null });
    expect(parseSheetConditions(MONASTIR_2)).toEqual({ surface: 'Outdoor Hard', ball: null });
  });

  it('reads values printed a fraction of a point off their label (Ankara 2026)', () => {
    // Real positions from the sheet: each value sits 0.1 pt above its label.
    const at = (x: number, y: number, str: string) => ({ x, y, str });
    const rows = joinRows([
      at(33.2, 922.5, 'Atak Pro Spor Kulübü'), at(238.4, 922.4, 'SURFACE:'), at(342.9, 922.5, 'Indoor Hard'),
      at(520.8, 922.4, 'LAUNDRY:'), at(613.2, 922.5, 'In the hotel'),
      at(33.2, 910.5, 'Çamlıca Mah. 147. Cad. No: 23/8'), at(238.4, 910.4, 'SURFACE BRAND:'), at(342.9, 910.5, 'Terraco Flexipave'),
      at(520.8, 910.4, 'LAUNDRY COST:'), at(613.2, 910.5, '€6/kg'),
      at(33.2, 898.5, 'Macunköy Eğitim ve Spor Tesisi'), at(238.4, 898.4, 'BALL:'), at(342.9, 898.5, 'Dunlop ATP Hard'),
      at(520.8, 898.4, 'FOOD:'), at(613.2, 898.5, 'Restaurant on site, Buffet style (11:30-15:00)'),
    ]);
    expect(rows).toHaveLength(3);
    expect(parseSheetConditions(rows.join('\n'))).toEqual({ surface: 'Indoor Hard', ball: 'Dunlop ATP Hard' });
  });

  it('reads ATP Tour sheets, whose labels have no colon (Paris 2026)', () => {
    const at = (x: number, y: number, str: string) => ({ x, y, str });
    const rows = joinRows([
      at(208.6, 427.9, 'SURFACE'), at(255.6, 427.9, 'Indoor Hard'), at(398.7, 423.4, 'Rémy Azemar'),
      at(26.4, 404.4, '•'), at(40.0, 404.4, 'Doubles final: 12:30'), at(398.7, 404.2, 'razemar@fft.fr'),
      at(208.6, 403.9, 'BALL'), at(234.7, 403.9, 'Dunlop ATP'),
    ]);
    expect(parseSheetConditions(rows.join('\n'))).toEqual({ surface: 'Indoor Hard', ball: 'Dunlop ATP' });
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
  });

  it('shows the average high, low and humidity', () => {
    expect(weatherLine({ high: 29, low: 20, humidity: 70 })).toBe('29° / 20°C · 70% humidity');
    expect(weatherLine({ high: 29, low: 20, humidity: null })).toBe('29° / 20°C');
  });

  it('converts to °F and feet when imperial', () => {
    // Florianópolis and Ankara, Nov 23 2026.
    expect(weatherLine({ high: 25, low: 20, humidity: 82 }, true)).toBe('77° / 68°F · 82% humidity');
    expect(elevationText(865)).toBe('865 m');
    expect(elevationText(865, true)).toBe('2,838 ft');
  });

  it('has nothing to say without temperatures', () => {
    expect(summarizeClimate([], 5)).toBeNull();
    expect(weatherLine({ high: null, low: null, humidity: 70 })).toBeNull();
  });
});

// Playing conditions for a tournament week, shown on the Builder's info card:
// the week's usual weather and the venue's elevation (Open-Meteo), plus the
// ball and court brand from the ProTennisLive detail sheet. Pure helpers only —
// storage and fetching live in edition-conditions.ts.

export type EditionConditions = {
  elevation: number | null;
  /** Averages over the same week in the five seasons before: °C, rainy days (≥ 1 mm) per week, %, km/h. */
  high: number | null;
  low: number | null;
  rainDays: number | null;
  humidity: number | null;
  wind: number | null;
  ball: string | null;
  court: string | null;
  indoor: boolean;
};

export type SheetConditions = { surface: string | null; courtBrand: string | null; ball: string | null };

// A Challenger detail sheet's site block is a three-column table, so each line
// carries cells like "…\tSURFACE BRAND:\tDecoturf\tLAUNDRY COST:\t…"; a blank
// field leaves the label followed straight by the next label. ATP Tour sheets
// (Paris, Stockholm) write the labels without a colon — "BALL\tDunlop ATP" —
// and have no surface brand.
function sheetField(rowText: string, label: string): string | null {
  for (const line of rowText.split('\n')) {
    const cells = line.split('\t').map((cell) => cell.trim()).filter(Boolean);
    for (let i = 0; i < cells.length; i += 1) {
      if (cells[i] === `${label}:` || cells[i] === label) {
        const value = cells[i + 1];
        return value && !value.endsWith(':') ? value : null;
      }
      // Label and value occasionally arrive as one text item.
      if (cells[i].startsWith(`${label}: `)) return cells[i].slice(label.length + 1).trim() || null;
    }
  }
  return null;
}

/** SURFACE, SURFACE BRAND and BALL from a detail sheet's tab-joined row text. */
export function parseSheetConditions(rowText: string): SheetConditions {
  return {
    surface: sheetField(rowText, 'SURFACE'),
    courtBrand: sheetField(rowText, 'SURFACE BRAND'),
    ball: sheetField(rowText, 'BALL'),
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The edition's own seven days (start date + 6) in each of the `seasons`
 * years before it. Date arithmetic rather than a month/day filter, so a week
 * that runs over New Year stays one week.
 */
export function climateWindows(startDate: string, seasons = 5): Array<{ start: string; end: string }> {
  const [y, m, d] = startDate.split('-').map(Number);
  const windows = [];
  for (let back = 1; back <= seasons; back += 1) {
    // Feb 29 has no twin in most years; Date.UTC rolls it to Mar 1, so clamp to Feb 28.
    const day = m === 2 && d === 29 ? 28 : d;
    const start = new Date(Date.UTC(y - back, m - 1, day));
    const end = new Date(start.getTime() + 6 * 86_400_000);
    windows.push({ start: isoDay(start), end: isoDay(end) });
  }
  return windows;
}

export type DailyWeather = {
  high: number | null;
  low: number | null;
  precipitation: number | null;
  humidity: number | null;
  wind: number | null;
};

export type ClimateSummary = Pick<EditionConditions, 'high' | 'low' | 'rainDays' | 'humidity' | 'wind'>;

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (value: number | null, digits = 0) => (value == null ? null : Number(value.toFixed(digits)));

/** Averages across every day of every window; rainy days are per week. */
export function summarizeClimate(days: DailyWeather[], windowCount: number): ClimateSummary | null {
  const pick = (key: keyof DailyWeather) => days.map((day) => day[key]).filter((v): v is number => v != null);
  const highs = pick('high');
  if (highs.length === 0 || windowCount === 0) return null;
  const rain = pick('precipitation');
  return {
    high: round(mean(highs)),
    low: round(mean(pick('low'))),
    rainDays: rain.length ? round(rain.filter((mm) => mm >= 1).length / windowCount, 1) : null,
    humidity: round(mean(pick('humidity'))),
    wind: round(mean(pick('wind'))),
  };
}

/** "25° / 20°C": the week's average high and low. */
export function weatherLine(c: Pick<ClimateSummary, 'high' | 'low'>): string | null {
  if (c.high == null || c.low == null) return null;
  return `${c.high}° / ${c.low}°C`;
}

export function hasAnyConditions(c: EditionConditions | undefined): c is EditionConditions {
  return Boolean(c && (c.high != null || c.elevation != null || c.ball || c.court));
}

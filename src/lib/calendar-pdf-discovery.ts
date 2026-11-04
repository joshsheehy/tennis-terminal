// Where the official ATP calendar PDFs live, and how to read a Challenger row
// out of them. Shared by the runner-side parser (scripts/diagnose-calendar-pdf.mjs,
// the source of truth for the nightly import) and the server-side backup
// (/api/sync-official-calendar), which used to carry two hand-synced copies.
//
// Nothing lists these files in a form a datacenter IP may read (atptour.com's
// pages 403 runners and Railway alike), so discovery guesses filenames and
// probes the public file hosts. Every miss below was a real naming the old
// guesses did not cover:
//
// - Folder = the year a file is PUBLISHED, not the season it covers:
//     2025/2026-atp-tour-calendar-december-2025.pdf
//     2026/2027-atp-tour-calendar-14-january-2026-updated.pdf
//   So next season's first Challenger calendar, published in December, sits in
//   THIS year's folder. The old probe only looked for it under next year's.
// - Re-uploads get a suffix: "...-as-of-10-march-2026-updated.pdf",
//   "...-as-of-21-october-2026-1.pdf" (the one ATP's Challenger page links).
// - The single-season name is used too: 2026-atp-challenger-calendar-as-of-4-january-2026.pdf

export const ATP_CALENDAR_CDN = 'https://www.atptour.com/-/media/files/calendar-pdfs';
export const PLAYER_ZONE_CALENDARS = 'https://rsc.atppz.com/-/media/atp-player-zone/pdf-files/calendars';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const yy = (year: number) => String(year % 100).padStart(2, '0');
const unique = <T,>(items: T[]) => Array.from(new Set(items));

/** ATP Player Zone combined calendar (2-season Tour pages + this season's Challenger table). */
export function playerZoneCalendarUrls(season: number, published: Date): string[] {
  const ymd = published.toISOString().slice(0, 10).replace(/-/g, '');
  return unique([season, published.getUTCFullYear()]).map(
    (folder) => `${PLAYER_ZONE_CALENDARS}/${folder}/${ymd}_${season}_combined_calendar.pdf`
  );
}

export type ChallengerCalendarFamily = 'season' | 'season-two-year' | 'previous-two-year';

/**
 * atptour.com Challenger calendar candidates published on `published` that
 * could hold `season`'s Challengers, grouped by filename family:
 *   season             {S}-atp-challenger-calendar-as-of-…
 *   season-two-year    {S}-{S+1}-atp-challenger-calendar-as-of-…
 *   previous-two-year  {S-1}-{S}-atp-challenger-calendar-as-of-…
 */
export function challengerCalendarUrls(
  season: number,
  published: Date
): Array<{ family: ChallengerCalendarFamily; url: string }> {
  const pubYear = published.getUTCFullYear();
  const day = published.getUTCDate();
  const asOfs = unique([String(day), String(day).padStart(2, '0')]).map(
    (d) => `as-of-${d}-${MONTH_NAMES[published.getUTCMonth()]}-${pubYear}`
  );
  const families: Array<{ family: ChallengerCalendarFamily; prefix: string; folders: number[] }> = [
    { family: 'season', prefix: `${season}-atp-challenger-calendar`, folders: [season, pubYear] },
    { family: 'season-two-year', prefix: `${season}-${yy(season + 1)}-atp-challenger-calendar`, folders: [season, pubYear] },
    { family: 'previous-two-year', prefix: `${season - 1}-${yy(season)}-atp-challenger-calendar`, folders: [season - 1, pubYear] },
  ];
  const out: Array<{ family: ChallengerCalendarFamily; url: string }> = [];
  for (const { family, prefix, folders } of families) {
    for (const folder of unique(folders)) {
      for (const asOf of asOfs) {
        for (const suffix of ['', '-updated', '-1']) {
          out.push({ family, url: `${ATP_CALENDAR_CDN}/${folder}/${prefix}-${asOf}${suffix}.pdf` });
        }
      }
    }
  }
  return out;
}

/** Probe newest-first from the newest plausible publish date (today, or the
 * season's last day for a past season). */
function probeStart(season: number, now: Date): Date {
  const seasonEnd = Date.UTC(season, 11, 31);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(Math.min(seasonEnd, today));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export type DiscoveryOptions = {
  season: number;
  exists: (url: string) => Promise<boolean>;
  now?: Date;
  lookBackDays?: number;
  concurrency?: number;
};

/** Newest Player Zone combined calendar for the season, if any. */
export async function discoverPlayerZoneCalendars(opts: DiscoveryOptions): Promise<string[]> {
  const start = probeStart(opts.season, opts.now ?? new Date());
  for (let back = 0; back <= (opts.lookBackDays ?? 120); back += 1) {
    const urls = playerZoneCalendarUrls(opts.season, new Date(start.getTime() - back * DAY_MS));
    const hits = await mapLimit(urls, opts.concurrency ?? 4, opts.exists);
    const found = urls.filter((_, i) => hits[i]);
    if (found.length) return found;
  }
  return [];
}

/**
 * Newest atptour.com Challenger calendar per filename family, newest first.
 * Each family stops at its newest hit; the walk ends when every family has one
 * or the look-back runs out.
 */
export async function discoverChallengerCalendars(opts: DiscoveryOptions): Promise<string[]> {
  const start = probeStart(opts.season, opts.now ?? new Date());
  const found = new Map<ChallengerCalendarFamily, string>();
  const order: string[] = [];
  for (let back = 0; back <= (opts.lookBackDays ?? 120) && found.size < 3; back += 1) {
    const candidates = challengerCalendarUrls(opts.season, new Date(start.getTime() - back * DAY_MS)).filter(
      (c) => !found.has(c.family)
    );
    const hits = await mapLimit(candidates, opts.concurrency ?? 6, (c) => opts.exists(c.url));
    candidates.forEach((c, i) => {
      if (hits[i] && !found.has(c.family)) {
        found.set(c.family, c.url);
        order.push(c.url);
      }
    });
  }
  return order;
}

/**
 * One row of the Challenger table as text-extracted from the PDF:
 *   [week date] Name CTY level [currency] prize surface [notes]
 * Surfaces: H, C/CL, G, and indoor variants IH, IC (indoor clay — Maia's "IC"
 * failed the old pattern, and the event never reached the site).
 */
export const CHALLENGER_ROW_PATTERN =
  /^(?:(\d{1,2})\s+(\d{1,2}[-\s][A-Za-z]{3})\s+)?(.+?)\s+([A-Z]{3})\s+(50|75|100|125|175)\s+(?:(?:USD|EUR|€|\$)\s*)?[0-9][0-9,.]*\s+((?:I?(?:CL|H|C|G))\*?)\b(.*)$/i;

/**
 * True for a line that carries a Challenger row's signature — a category and a
 * prize amount in a currency — whether or not CHALLENGER_ROW_PATTERN accepts
 * it. A line that does and fails the pattern is a tournament the parser is
 * dropping, which the sync treats as an error rather than a log line.
 */
export function looksLikeChallengerRow(line: string): boolean {
  return (
    /\b[A-Z]{3}\s+(50|75|100|125|175)\b/.test(line) &&
    /(?:\b(?:USD|EUR)\b|[€$])\s*[0-9]{2,3}[,.][0-9]{2,3}/.test(line)
  );
}

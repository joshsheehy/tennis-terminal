import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from '@/lib/atp-week';
import slugify from 'slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OfficialCalendarRow = {
  name: string;
  city: string;
  country: string | null;
  week: number;
  startDate: string;
  level: string;
  surface: string;
  indoor: boolean;
  sourcePdfUrl: string;
};

type PositionedText = {
  str: string;
  x: number;
  y: number;
  pageWidth: number;
};

type PdfPageLike = {
  getViewport?: (opts: { scale: number }) => { width: number };
  getTextContent: (opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }) => Promise<{
    items: Array<{ str?: string; transform?: number[] }>;
  }>;
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const COUNTRY_BY_ATP_CODE: Record<string, string> = {
  ARG: 'Argentina', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium', BIH: 'Bosnia and Herzegovina',
  BOL: 'Bolivia', BRA: 'Brazil', BRN: 'Bahrain', BUL: 'Bulgaria', CAN: 'Canada', CGO: 'Congo',
  CHI: 'Chile', CHN: 'China', CIV: "Côte d'Ivoire", COL: 'Colombia', CRO: 'Croatia',
  CYP: 'Cyprus', CZE: 'Czech Republic', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt',
  ESP: 'Spain', FIN: 'Finland', FRA: 'France', GBR: 'Great Britain', GER: 'Germany', GRE: 'Greece',
  HKG: 'Hong Kong', HUN: 'Hungary', INA: 'Indonesia', IND: 'India', IRL: 'Ireland', ISR: 'Israel',
  ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan', KAZ: 'Kazakhstan', KOR: 'South Korea',
  MDA: 'Moldova', MEX: 'Mexico', NCL: 'New Caledonia', NED: 'Netherlands', NOR: 'Norway',
  NZL: 'New Zealand', PAR: 'Paraguay', POL: 'Poland', POR: 'Portugal', ROU: 'Romania',
  RSA: 'South Africa', RWA: 'Rwanda', SMR: 'San Marino', SUI: 'Switzerland', SVK: 'Slovakia',
  THA: 'Thailand', TPE: 'Chinese Taipei', TUN: 'Tunisia', TUR: 'Turkey', UAE: 'United Arab Emirates',
  USA: 'United States', UZB: 'Uzbekistan', VIE: 'Vietnam',
};

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function cleanName(value: string) {
  return value.replace(/[•†‡*]+/g, '').replace(/\s+/g, ' ').trim();
}

function deriveCity(name: string) {
  return cleanName(name).replace(/\s*\([^)]*\)/g, '').replace(/,\s*[A-Z]{2}$/g, '').trim();
}

function fallbackSlugFor(name: string, city: string) {
  const base = deriveCity(name) || city || name;
  return slugify(base, { lower: true, strict: true, trim: true });
}

function parseDateToken(token: string, year: number): string | null {
  const match = token.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTH_ABBR[match[2].toLowerCase()];
  if (!day || !month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeSurface(code: string) {
  const normalized = code.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (normalized === 'IH') return { surface: 'Indoor Hard', indoor: true };
  if (normalized === 'H') return { surface: 'Hard', indoor: false };
  if (normalized === 'C' || normalized === 'CL') return { surface: 'Clay', indoor: false };
  if (normalized === 'G') return { surface: 'Grass', indoor: false };
  return { surface: 'Hard', indoor: false };
}

function findCanonical(name: string, city: string, editionYear: number) {
  const nameKey = normalizeKey(name);
  const cityKey = normalizeKey(city);
  return (
    ALL_EDITIONS.find((entry) => entry.edition.year === editionYear && normalizeKey(entry.tournament.name) === nameKey) ??
    ALL_EDITIONS.find(
      (entry) =>
        entry.edition.year === editionYear &&
        entry.edition.level.toLowerCase().includes('challenger') &&
        normalizeKey(entry.tournament.city) === cityKey &&
        (normalizeKey(entry.tournament.name) === cityKey || normalizeKey(entry.tournament.name).startsWith(cityKey))
    ) ??
    ALL_EDITIONS.find((entry) => normalizeKey(entry.tournament.name) === nameKey)
  );
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`ATP Tour returned ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: 'application/pdf,*/*;q=0.8' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`PDF fetch returned ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function rebuildLinesFromPositionedItems(items: PositionedText[]) {
  const sortedByY = items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PositionedText[][] = [];
  for (const item of sortedByY) {
    const group = groups.find((existing) => Math.abs(existing[0].y - item.y) <= 2.5);
    if (group) group.push(item);
    else groups.push([item]);
  }

  const lines: string[] = [];
  for (const group of groups) {
    const left = group.filter((item) => item.x < item.pageWidth * 0.52);
    const right = group.filter((item) => item.x >= item.pageWidth * 0.48);
    for (const side of [left, right]) {
      const text = side
        .sort((a, b) => a.x - b.x)
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 0) lines.push(text);
    }
  }
  return lines;
}

async function extractPositionedPdfLines(buffer: Buffer): Promise<string[]> {
  // Use pdf-parse's pagerender hook instead of importing pdfjs-dist directly.
  // Direct pdfjs-dist imports make Next/Railway try to bundle the optional
  // native canvas package and fail the production build.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as (
    b: Buffer,
    options?: { pagerender?: (pageData: PdfPageLike) => Promise<string> }
  ) => Promise<{ text: string }>;

  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData: PdfPageLike) => {
      const viewport = typeof pageData.getViewport === 'function' ? pageData.getViewport({ scale: 1 }) : { width: 612 };
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const items: PositionedText[] = content.items
        .map((item) => {
          const str = typeof item.str === 'string' ? item.str.trim() : '';
          const transform = item.transform;
          if (!str || !Array.isArray(transform) || transform.length < 6) return null;
          return {
            str,
            x: Number(transform[4] ?? 0),
            y: Number(transform[5] ?? 0),
            pageWidth: viewport.width,
          };
        })
        .filter((item): item is PositionedText => item !== null);

      return rebuildLinesFromPositionedItems(items).join('\n');
    },
  });

  return Array.from(
    new Set(
      (parsed.text ?? '')
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  );
}

function findCalendarPdfUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const hrefPattern = /(?:href|data-url|src)=["']([^"']*\.pdf[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const raw = match[1];
    if (!/calendar/i.test(raw)) continue;
    let absoluteUrl: string;
    if (raw.startsWith('http')) absoluteUrl = raw;
    else if (raw.startsWith('//')) absoluteUrl = `https:${raw}`;
    else if (raw.startsWith('/')) absoluteUrl = `https://www.atptour.com${raw}`;
    else {
      try {
        absoluteUrl = new URL(raw, baseUrl).toString();
      } catch {
        continue;
      }
    }
    if (/challenger-calendar/i.test(absoluteUrl)) found.add(absoluteUrl);
  }
  return Array.from(found);
}

async function probeUrlExists(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: 'HEAD', headers: BROWSER_HEADERS, cache: 'no-store', signal: controller.signal });
    if (res.status === 405) {
      res = await fetch(url, { method: 'GET', headers: { ...BROWSER_HEADERS, Range: 'bytes=0-0' }, cache: 'no-store', signal: controller.signal });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverLatestChallengerCalendarPdfs(year: number, lookBackDays = 120) {
  const today = new Date();
  const yy2 = String((year + 1) % 100).padStart(2, '0');
  const prefixes = [`${year}-${yy2}-atp-challenger-calendar`, `${year}-atp-challenger-calendar`];
  const discovered: string[] = [];
  for (const prefix of prefixes) {
    let foundForPrefix: string | null = null;
    for (let back = 0; back <= lookBackDays && !foundForPrefix; back += 1) {
      const probeDate = new Date(today.getTime() - back * 24 * 60 * 60 * 1000);
      const day = probeDate.getUTCDate();
      const month = MONTH_NAMES[probeDate.getUTCMonth()];
      const probeYear = probeDate.getUTCFullYear();
      for (const dayVariant of [String(day), String(day).padStart(2, '0')]) {
        const filename = `${prefix}-as-of-${dayVariant}-${month}-${probeYear}.pdf`;
        const url = `https://www.atptour.com/-/media/files/calendar-pdfs/${year}/${filename}`;
        if (await probeUrlExists(url)) {
          foundForPrefix = url;
          break;
        }
      }
    }
    if (foundForPrefix) discovered.push(foundForPrefix);
  }
  return discovered;
}

async function discoverOfficialPdfUrls(year: number) {
  const pages = ['https://www.atptour.com/en/tournaments', 'https://www.atptour.com/en/atp-challenger-tour/calendar'];
  const urls = new Set<string>();
  const pageErrors: Array<{ url: string; error: string }> = [];
  for (const pageUrl of pages) {
    try {
      const html = await fetchHtml(pageUrl);
      for (const pdfUrl of findCalendarPdfUrls(html, pageUrl)) urls.add(pdfUrl);
    } catch (error) {
      pageErrors.push({ url: pageUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (urls.size === 0) {
    for (const pdfUrl of await discoverLatestChallengerCalendarPdfs(year)) urls.add(pdfUrl);
  }
  return { urls: Array.from(urls), pageErrors };
}

function parseOfficialChallengerRows(lines: string[], year: number, sourcePdfUrl: string) {
  const rows: OfficialCalendarRow[] = [];
  const skipped: Array<{ name: string; reason: string; line: string }> = [];
  let currentWeek: number | null = null;
  let currentStartDate: string | null = null;

  const rowPattern = /^(?:(\d{1,2})\s+(\d{1,2}[-\s][A-Za-z]{3})\s+)?(.+?)\s+([A-Z]{3})\s+(50|75|100|125|175)\s+(?:(?:USD|EUR|€|\$)\s*)?[0-9][0-9,\.]*\s+((?:IH|CL|H|C|G)\*?)\b(.*)$/i;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const match = rowPattern.exec(line);
    if (!match) continue;

    if (match[1] && match[2]) {
      currentWeek = Number(match[1]);
      currentStartDate = parseDateToken(match[2], year);
    }
    if (currentWeek === null || !currentStartDate) continue;

    const name = cleanName(match[3]);
    const countryCode = match[4].toUpperCase();
    const levelNumber = match[5];
    const surfaceCode = match[6];
    const notes = match[7] ?? '';

    if (/cancelled|postponed/i.test(notes)) {
      skipped.push({ name, reason: 'cancelled_or_postponed', line });
      continue;
    }

    const { surface, indoor } = normalizeSurface(surfaceCode);
    const city = deriveCity(name);
    rows.push({
      name,
      city,
      country: COUNTRY_BY_ATP_CODE[countryCode] ?? countryCode,
      week: currentWeek,
      startDate: currentStartDate,
      level: `Challenger ${levelNumber}`,
      surface,
      indoor,
      sourcePdfUrl,
    });
  }
  return { rows, skipped };
}

async function upsertOfficialRow(row: OfficialCalendarRow, requestedYear: number, dryRun: boolean) {
  const editionYear = getAtpEditionYearForStartDate(row.startDate, requestedYear);
  const week = getAtpWeekForSeason(row.startDate, editionYear) ?? row.week;
  const canonical = findCanonical(row.name, row.city, editionYear);
  const name = canonical?.tournament.name ?? row.name;
  const city = canonical?.tournament.city ?? row.city;
  const country = canonical?.tournament.country ?? row.country;
  const slug = canonical?.tournament.slug ?? fallbackSlugFor(name, city);
  const code = canonical?.edition.protennislive_code ?? null;
  const sourceUrl = code ? `${row.sourcePdfUrl} | https://www.protennislive.com/posting/${editionYear}/${code}/` : row.sourcePdfUrl;

  const result = { slug, name, city, country, year: editionYear, week, startDate: row.startDate, level: row.level, surface: row.surface, sourceUrl, hasProTennisLiveCode: Boolean(code) };
  if (dryRun) return result;

  const tournamentResult = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set
       name = excluded.name,
       city = excluded.city,
       country = excluded.country,
       updated_at = now()
     returning id`,
    [slug, name, city, country]
  );

  await pool.query(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, end_date, level, surface,
       indoor, source, source_url, status, updated_at
     ) values ($1, $2, $3, $4, null, $5, $6, $7, 'atp_official_calendar_pdf', $8, 'held', now())
     on conflict (tournament_id, year) do update set
       week = excluded.week,
       start_date = excluded.start_date,
       level = excluded.level,
       surface = excluded.surface,
       indoor = excluded.indoor,
       source = excluded.source,
       source_url = excluded.source_url,
       status = 'held',
       updated_at = now()`,
    [tournamentResult.rows[0].id, editionYear, week, row.startDate, row.level, row.surface, row.indoor, sourceUrl]
  );

  return result;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2024 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'year must be between 2024 and 2030' }, { status: 400 });
  }

  const dryRun = params.get('apply') === 'false';
  const debug = params.get('debug') === 'true';
  const explicitPdfUrls = (params.get('pdfUrl') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const discovered = explicitPdfUrls.length > 0 ? { urls: explicitPdfUrls, pageErrors: [] } : await discoverOfficialPdfUrls(year);

  if (discovered.urls.length === 0) {
    return NextResponse.json({ ok: false, error: 'No official ATP Challenger calendar PDF found.', pageErrors: discovered.pageErrors }, { status: 502 });
  }

  const pdfResults: Array<{ url: string; extractedLines: number; parsedRows: number; skippedRows: number; sampleLines?: string[]; error?: string }> = [];
  const allRows: OfficialCalendarRow[] = [];
  const skippedRows: Array<{ name: string; reason: string; line: string }> = [];

  for (const pdfUrl of discovered.urls) {
    try {
      const buffer = await fetchPdfBuffer(pdfUrl);
      const lines = await extractPositionedPdfLines(buffer);
      const parsed = parseOfficialChallengerRows(lines, year, pdfUrl);
      allRows.push(...parsed.rows);
      skippedRows.push(...parsed.skipped);
      pdfResults.push({
        url: pdfUrl,
        extractedLines: lines.length,
        parsedRows: parsed.rows.length,
        skippedRows: parsed.skipped.length,
        ...(debug || parsed.rows.length === 0 ? { sampleLines: lines.slice(0, 80) } : {}),
      });
    } catch (error) {
      pdfResults.push({ url: pdfUrl, extractedLines: 0, parsedRows: 0, skippedRows: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const uniqueRows = new Map<string, OfficialCalendarRow>();
  for (const row of allRows) {
    const editionYear = getAtpEditionYearForStartDate(row.startDate, year);
    if (editionYear !== year) continue;
    uniqueRows.set(`${editionYear}|${normalizeKey(row.name)}|${row.startDate}`, row);
  }

  const upserted = [];
  const failed = [];
  for (const row of uniqueRows.values()) {
    try {
      upserted.push(await upsertOfficialRow(row, year, dryRun));
    } catch (error) {
      failed.push({ name: row.name, startDate: row.startDate, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0 && upserted.length > 0,
    dryRun,
    year,
    pdfUrls: discovered.urls,
    pageErrors: discovered.pageErrors,
    pdfResults,
    parsedRowCount: allRows.length,
    uniqueSeasonRowCount: uniqueRows.size,
    upsertedCount: upserted.length,
    failedCount: failed.length,
    skippedCancelledOrPostponedCount: skippedRows.length,
    withoutProTennisLiveCodeCount: upserted.filter((row) => !row.hasProTennisLiveCode).length,
    sampleUpserted: upserted.slice(0, 30),
    sampleSkippedCancelledOrPostponed: skippedRows.slice(0, 15),
    failed,
  });
}

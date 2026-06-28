import { NextRequest, NextResponse } from 'next/server';
import { getAtpEditionYearForStartDate } from '@/lib/atp-week';
import {
  cleanName,
  deriveCity,
  normalizeKey,
  normalizeSurface,
  upsertOfficialRow,
  COUNTRY_BY_ATP_CODE,
  type OfficialCalendarRow,
} from '@/lib/official-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function parseDateToken(token: string, year: number): string | null {
  const match = token.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTH_ABBR[match[2].toLowerCase()];
  if (!day || !month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

// Primary extractor: modern pdf.js. pdf-parse v1 bundles a ~2017 pdf.js that
// extracts zero text items from current ATP calendar PDFs, and the r.jina.ai
// fallback started returning boilerplate-only output — leaving this import a
// silent no-op. Validated against the live 2026-27 challenger calendar PDF in
// CI (scripts/diagnose-calendar-pdf.mjs) before being wired in here.
async function extractPdfjsLines(buffer: Buffer): Promise<string[]> {
  const pdfjsModule: unknown = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = pdfjsModule as {
    getDocument: (opts: {
      data: Uint8Array;
      isEvalSupported?: boolean;
      disableFontFace?: boolean;
      useSystemFonts?: boolean;
    }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getViewport: (o: { scale: number }) => { width: number };
          getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
        }>;
        destroy: () => Promise<void>;
      }>;
    };
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;

  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PositionedText[] = content.items
        .map((item) => {
          const str = typeof item.str === 'string' ? item.str.trim() : '';
          if (!str || !Array.isArray(item.transform) || item.transform.length < 6) return null;
          return { str, x: Number(item.transform[4] ?? 0), y: Number(item.transform[5] ?? 0), pageWidth: viewport.width };
        })
        .filter((item): item is PositionedText => item !== null);
      lines.push(...rebuildLinesFromPositionedItems(items));
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return Array.from(new Set(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

async function extractPdfParseLines(buffer: Buffer): Promise<string[]> {
  // This works for normal text PDFs. It returns zero lines for some ATP calendar
  // PDFs, so the endpoint falls back to Reader below.
  // Deliberate lazy require: top-level pdf-parse imports crash under bundlers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
          return { str, x: Number(transform[4] ?? 0), y: Number(transform[5] ?? 0), pageWidth: viewport.width };
        })
        .filter((item): item is PositionedText => item !== null);
      return rebuildLinesFromPositionedItems(items).join('\n');
    },
  });

  return normalizeReaderTextToLines(parsed.text ?? '');
}

function normalizeReaderTextToLines(text: string): string[] {
  return Array.from(
    new Set(
      text
        .replace(/\r/g, '\n')
        .split('\n')
        .flatMap((rawLine) => {
          const line = rawLine
            .replace(/^Title:\s*/i, '')
            .replace(/^URL Source:\s*/i, '')
            .replace(/^Markdown Content:\s*/i, '')
            .replace(/^#+\s*/, '')
            .replace(/^[-*]\s*/, '')
            .replace(/\|/g, ' | ')
            .replace(/\s+/g, ' ')
            .trim();
          return line ? [line] : [];
        })
        .filter(Boolean)
    )
  );
}

async function fetchReaderLinesForPdf(pdfUrl: string): Promise<string[]> {
  const readerUrl = `https://r.jina.ai/${pdfUrl}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(readerUrl, {
      headers: {
        Accept: 'text/plain, text/markdown, */*',
        'User-Agent': 'TennisTerminalCalendarSync/1.0',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Reader returned ${res.status}`);
    return normalizeReaderTextToLines(await res.text());
  } finally {
    clearTimeout(timer);
  }
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
  // For past seasons the newest "as-of" PDF was published near that season's
  // end, not near today — probe backwards from Dec 31 of the season year.
  const now = new Date();
  const seasonEnd = new Date(Date.UTC(year, 11, 31));
  const today = seasonEnd.getTime() < now.getTime() ? seasonEnd : now;

  const yyNext = String((year + 1) % 100).padStart(2, '0'); // year as FIRST season:  {year}-{yyNext}
  const yyThis = String(year % 100).padStart(2, '0');        // year as SECOND season: {year-1}-{yyThis}

  // (folder, prefix) combos to probe. The ATP publishes a two-season
  // "{A}-{A+1}" PDF inside folder {A}, and that single file covers BOTH season
  // A and season A+1. So a year can be found two ways:
  //   1. As the FIRST season of its own two-season PDF (folder = year).
  //   2. As the SECOND season of the PREVIOUS year's PDF (folder = year-1) —
  //      this is how e.g. 2027 events are found inside the 2026-27 PDF before
  //      a standalone 2027-28 file ever exists. Without this, year=2027
  //      discovery looked only in /2027/ and returned "no PDF found".
  const combos: Array<{ folder: number; prefix: string }> = [
    { folder: year, prefix: `${year}-${yyNext}-atp-challenger-calendar` },
    { folder: year, prefix: `${year}-atp-challenger-calendar` },
    { folder: year - 1, prefix: `${year - 1}-${yyThis}-atp-challenger-calendar` },
  ];

  const discovered: string[] = [];
  for (const { folder, prefix } of combos) {
    let foundForPrefix: string | null = null;
    for (let back = 0; back <= lookBackDays && !foundForPrefix; back += 1) {
      const probeDate = new Date(today.getTime() - back * 24 * 60 * 60 * 1000);
      const day = probeDate.getUTCDate();
      const month = MONTH_NAMES[probeDate.getUTCMonth()];
      const probeYear = probeDate.getUTCFullYear();
      for (const dayVariant of [String(day), String(day).padStart(2, '0')]) {
        const filename = `${prefix}-as-of-${dayVariant}-${month}-${probeYear}.pdf`;
        const url = `https://www.atptour.com/-/media/files/calendar-pdfs/${folder}/${filename}`;
        if (await probeUrlExists(url)) {
          foundForPrefix = url;
          break;
        }
      }
    }
    if (foundForPrefix) discovered.push(foundForPrefix);
  }
  return Array.from(new Set(discovered));
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
  // These PDFs cover two seasons (e.g. "2026-27"): a "<year> CALENDAR" header
  // (and "JAN 2027"-style month headers) marks each section. Rows outside the
  // requested season are skipped so e.g. importing 2025 from the late-season
  // 2025-26 PDF doesn't stamp 2026 events with 2025 dates.
  let sectionYear = year;

  const sectionPattern = /\b(20\d{2})\s+CALENDAR\b/i;
  const monthHeaderPattern = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})$/i;
  const rowPattern = /^(?:(\d{1,2})\s+(\d{1,2}[-\s][A-Za-z]{3})\s+)?(.+?)\s+([A-Z]{3})\s+(50|75|100|125|175)\s+(?:(?:USD|EUR|€|\$)\s*)?[0-9][0-9,\.]*\s+((?:IH|CL|H|C|G)\*?)\b(.*)$/i;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const sectionMatch = sectionPattern.exec(line) ?? monthHeaderPattern.exec(line);
    if (sectionMatch) {
      const headerYear = Number(sectionMatch[1].length === 4 ? sectionMatch[1] : sectionMatch[2]);
      if (headerYear >= 2000 && headerYear <= 2100 && headerYear !== sectionYear) {
        sectionYear = headerYear;
        // Week/date context never carries across season sections.
        currentWeek = null;
        currentStartDate = null;
      }
      continue;
    }

    const match = rowPattern.exec(line);
    if (!match) continue;

    if (match[1] && match[2]) {
      currentWeek = Number(match[1]);
      // ATP seasons can start in the prior December (e.g. 2025 week 1 begins
      // Mon 30 Dec 2024): an early-week December token belongs to the year
      // before the section's season.
      const token = match[2];
      const monthAbbr = token.trim().slice(-3).toLowerCase();
      const dateYear =
        monthAbbr === 'dec' && currentWeek <= 2 ? sectionYear - 1 : sectionYear;
      currentStartDate = parseDateToken(token, dateYear);
    }
    if (currentWeek === null || !currentStartDate) continue;
    if (sectionYear !== year) continue;

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
    // 200 on purpose: edge proxies replace 5xx bodies, hiding the reason.
    return NextResponse.json(
      { ok: false, error: 'No official ATP Challenger calendar PDF found.', pageErrors: discovered.pageErrors },
      { status: 200 }
    );
  }

  const pdfResults: Array<{ url: string; extractionSource: string; extractedLines: number; parsedRows: number; skippedRows: number; sampleLines?: string[]; error?: string }> = [];
  const allRows: OfficialCalendarRow[] = [];
  const skippedRows: Array<{ name: string; reason: string; line: string }> = [];

  for (const pdfUrl of discovered.urls) {
    try {
      const buffer = await fetchPdfBuffer(pdfUrl);
      let lines = await extractPdfjsLines(buffer).catch(() => [] as string[]);
      let extractionSource = 'pdfjs';
      if (lines.length === 0) {
        lines = await extractPdfParseLines(buffer);
        extractionSource = 'pdf-parse';
      }
      if (lines.length === 0) {
        lines = await fetchReaderLinesForPdf(pdfUrl);
        extractionSource = 'jina-reader';
      }
      const parsed = parseOfficialChallengerRows(lines, year, pdfUrl);
      allRows.push(...parsed.rows);
      skippedRows.push(...parsed.skipped);
      pdfResults.push({
        url: pdfUrl,
        extractionSource,
        extractedLines: lines.length,
        parsedRows: parsed.rows.length,
        skippedRows: parsed.skipped.length,
        ...(debug || parsed.rows.length === 0 ? { sampleLines: lines.slice(0, 120) } : {}),
      });
    } catch (error) {
      pdfResults.push({ url: pdfUrl, extractionSource: 'failed', extractedLines: 0, parsedRows: 0, skippedRows: 0, error: error instanceof Error ? error.message : String(error) });
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

  // Tournaments that were inserted for the first time on this run (isNew=true).
  // These are the genuinely-new calendar additions — what the operator and the
  // weekly cron actually care about.
  const newlyAdded = upserted
    .filter((row) => row.isNew === true)
    .map((row) => ({ slug: row.slug, name: row.name, city: row.city, year: row.year, week: row.week, level: row.level }));

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
    newlyAddedCount: newlyAdded.length,
    newlyAdded,
    failedCount: failed.length,
    skippedCancelledOrPostponedCount: skippedRows.length,
    withoutProTennisLiveCodeCount: upserted.filter((row) => !row.hasProTennisLiveCode).length,
    sampleUpserted: upserted.slice(0, 30),
    sampleSkippedCancelledOrPostponed: skippedRows.slice(0, 15),
    failed,
  });
}

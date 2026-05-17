import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from '@/lib/atp-week';
import slugify from 'slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Primary calendar source: atptour.com. The two pages we care about:
//   https://www.atptour.com/en/tournaments
//   https://www.atptour.com/en/atp-challenger-tour/calendar
//
// Both are Next.js pages. We extract tournament refs by:
//   1. URL pattern matching in the HTML
//        /en/tournaments/{city}/{code}/overview
//        /en/atp-challenger-tour/tournaments/{city}/{code}/overview
//        /en/scores/archive/{city}/{code}/{year}/
//   2. Walking the __NEXT_DATA__ JSON blob for tournament-like objects
//      with start_date / level / surface fields.
//
// We never delete existing editions — only insert new ones and update
// metadata. Cuts still come from ProTennisLive via the run-all sweep.

const CODE_TO_CANONICAL = new Map(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [Number(e.edition.protennislive_code), e])
);

type CalendarTournament = {
  code: number;
  citySlug: string;
  name?: string;
  city?: string;
  country?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  level?: string | null;
  surface?: string | null;
  isChallenger: boolean;
};

const URL_PATTERNS = [
  // ATP Tour upcoming/current tournament overview
  /\/en\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/overview/gi,
  // ATP Tour live scores
  /\/en\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/(?:draws|players|live-scores)/gi,
  // Challenger Tour
  /\/en\/atp-challenger-tour\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/(?:overview|draws|live-scores)/gi,
  // Archived pages (also surfaces here on calendar pages occasionally)
  /\/en\/scores\/archive\/([a-z0-9-]+)\/(\d{2,6})\/\d{4}\//gi,
];

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ATP Tour returned ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
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

// ATP CMS hosts calendar PDFs at /-/media/files/calendar-pdfs/{year}/...
// with filenames like "2026-27-atp-challenger-calendar-as-of-10-may-2026.pdf".
// Those filenames change on every update, so we discover the latest by HEAD-
// probing the last 90 days for each known prefix. First hit wins per prefix.
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function buildCalendarPdfPrefixes(year: number): string[] {
  const yy2 = String((year + 1) % 100).padStart(2, '0');
  return [
    `${year}-${yy2}-atp-challenger-calendar`,
    `${year}-atp-challenger-calendar`,
    `${year}-${yy2}-atp-tour-calendar`,
    `${year}-atp-tour-calendar`,
  ];
}

async function probeUrlExists(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HEAD is cheap, but some CDNs only return GET; fall back to a range GET
    // to avoid downloading the whole PDF just to test existence.
    let res = await fetch(url, {
      method: 'HEAD',
      headers: BROWSER_HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 405) {
      res = await fetch(url, {
        method: 'GET',
        headers: { ...BROWSER_HEADERS, Range: 'bytes=0-0' },
        cache: 'no-store',
        signal: controller.signal,
      });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverLatestCalendarPdfs(year: number, lookBackDays = 90): Promise<string[]> {
  const today = new Date();
  const prefixes = buildCalendarPdfPrefixes(year);
  const discovered: string[] = [];

  for (const prefix of prefixes) {
    let foundForPrefix: string | null = null;
    for (let back = 0; back <= lookBackDays && !foundForPrefix; back += 1) {
      const probeDate = new Date(today.getTime() - back * 24 * 60 * 60 * 1000);
      const day = probeDate.getUTCDate();
      const month = MONTH_NAMES[probeDate.getUTCMonth()];
      const probeYear = probeDate.getUTCFullYear();
      // The user-supplied example uses "10-may-2026" (one-digit day, no zero
      // padding). Try both the zero-padded and unpadded variants.
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

// Find calendar PDF links in the page HTML. The "2026-27 Calendar PDF"
// button on atptour.com renders as a normal <a href="...pdf"> link, so a
// regex sweep over the HTML is enough.
function findCalendarPdfUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const hrefPattern = /(?:href|data-url|src)=["']([^"']*\.pdf[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefPattern.exec(html)) !== null) {
    const raw = m[1];
    // Only keep links that look like a calendar download (the button label
    // / file name usually contains "calendar").
    if (!/calendar/i.test(raw)) continue;
    let abs: string;
    if (raw.startsWith('http')) abs = raw;
    else if (raw.startsWith('//')) abs = `https:${raw}`;
    else if (raw.startsWith('/')) abs = `https://www.atptour.com${raw}`;
    else {
      try {
        abs = new URL(raw, baseUrl).toString();
      } catch {
        continue;
      }
    }
    found.add(abs);
  }
  return Array.from(found);
}

// Extract tournament rows from a calendar PDF text dump. ATP's calendar
// PDFs are designed for visual layout, so pdf-parse linearises them in
// reading-column order and concatenates table cells without delimiters,
// e.g. "BRISBANEBRISBANE INTERNATIONAL PRESENTED BY ANZHATP 2503 2".
//
// Approach:
//  1. Split into per-year sections at "YYYY CALENDAR" headers (the PDF
//     covers the current + next ATP season).
//  2. For each category anchor (ATP 250 / ATP 500 / ATP MASTERS 1000 /
//     GRAND SLAM / ATP FINALS / UNITED CUP / etc.) scan a window of text
//     immediately before the anchor for:
//       - the tournament name (uppercase phrase ending with a tournament
//         keyword: OPEN, CHAMPIONSHIPS, MASTERS, CLASSIC, CUP, FINALS, ...)
//       - the city (uppercase phrase immediately before the name)
//       - the surface letter(s) right before the category token
//       - the nearest "DD-MMM" date token
//  3. Look up the canonical slug + ProTennisLive code by tournament name
//     so the resulting row can flow into run-all for cuts.
//
// This is best-effort: layout-recovery from a marketing PDF will always
// miss a few rows. We emit what we can and log totals so the operator
// can spot-check via ?apply=false.

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const NAME_KEYWORDS = [
  'OPEN', 'CHAMPIONSHIPS', 'CHAMPIONSHIP', 'MASTERS', 'CLASSIC', 'FINALS',
  'CUP', 'PRIX', 'INTERNATIONAL', 'INDOORS', 'ROLAND-GARROS', 'WIMBLEDON',
  'AUSTRALIAN', 'US OPEN', 'NITTO', 'GENERALI', 'CITI', 'MIFEL', 'NORDEA',
  'SWISS', 'BANK', 'BMW', 'ROLEX', 'ROTHESAY', 'MUBADALA', 'ERSTE',
  'MUTUA', 'NEXO', 'INTERNAZIONALI', 'TIRIAC', 'GONET', 'BITPANDA',
  'ABN', 'TERRA', 'LEXUS', 'VANDA', 'BCI', 'IEB', 'ABIERTO', 'QATAR',
  'PLAVA', 'MILLENNIUM', 'BNP', 'KINOSHITA', 'CHINA', 'CHENGDU', 'HANGZHOU',
  'BYBIT', 'BOSS', 'EFG', 'LIBEMA', 'EUROPEAN', 'DAVIS',
];

const CATEGORY_PATTERNS: Array<{ regex: RegExp; level: string }> = [
  { regex: /ATP\s*MASTERS\s*1000/i, level: 'ATP 1000' },
  { regex: /ATP\s*FINALS/i, level: 'ATP Finals' },
  { regex: /NEXT\s*GEN\s*ATP\s*FIN(?:ALS)?/i, level: 'Next Gen Finals' },
  { regex: /GRAND\s*SLAM/i, level: 'Grand Slam' },
  { regex: /UNITED\s*CUP/i, level: 'United Cup' },
  { regex: /DAVIS\s*CUP/i, level: 'Davis Cup' },
  { regex: /LAVER\s*CUP/i, level: 'Laver Cup' },
  { regex: /ATP\s*500/i, level: 'ATP 500' },
  { regex: /ATP\s*250/i, level: 'ATP 250' },
  { regex: /CHALLENGER\s*175/i, level: 'Challenger 175' },
  { regex: /CHALLENGER\s*125/i, level: 'Challenger 125' },
  { regex: /CHALLENGER\s*100/i, level: 'Challenger 100' },
  { regex: /CHALLENGER\s*75/i, level: 'Challenger 75' },
  { regex: /CHALLENGER\s*50/i, level: 'Challenger 50' },
];

const NAME_TO_CANONICAL = new Map<string, (typeof ALL_EDITIONS)[number]>();
for (const entry of ALL_EDITIONS) {
  const key = entry.tournament.name.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (!NAME_TO_CANONICAL.has(key)) NAME_TO_CANONICAL.set(key, entry);
}

function findAllCategoryHits(text: string): Array<{ start: number; end: number; level: string; raw: string }> {
  const hits: Array<{ start: number; end: number; level: string; raw: string }> = [];
  for (const { regex, level } of CATEGORY_PATTERNS) {
    const re = new RegExp(regex.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, level, raw: m[0] });
    }
  }
  // Sort by position, then prefer longer/more specific matches that share a start.
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  // Deduplicate overlapping hits at the same span.
  const filtered: typeof hits = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start < lastEnd) continue;
    filtered.push(h);
    lastEnd = h.end;
  }
  return filtered;
}

function extractDateNear(text: string, hintYear: number): string | null {
  // DD-MMM (most common in ATP PDFs). Also tolerate "DD MMM".
  const m = text.match(/(\d{1,2})[-\s](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTH_ABBR[m[2].toLowerCase()];
  if (!day || !month || day < 1 || day > 31) return null;
  // PDFs include both current + next year; assume the year is the one of the
  // surrounding section. The caller scopes us by section already.
  const sectionYear = hintYear;
  return `${sectionYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractNameAndCityBefore(window: string): { name: string | null; city: string | null } {
  // Walk backward from the end of the window collecting the uppercase phrase
  // that ends just before the category token. The trailing fragment is the
  // tournament name; whatever uppercase block precedes it is the city.
  const cleaned = window
    .replace(/[\s\n]+/g, ' ')
    .replace(/[‘’′]/g, "'")
    .trim();

  // Pull the last contiguous run of uppercase-ish words (letters, digits,
  // punctuation but not lower-case). Stop at the first lowercase letter.
  const upperRun = cleaned.match(/[A-Z0-9'’.&,\- ]{4,}$/);
  if (!upperRun) return { name: null, city: null };
  const tokens = upperRun[0].trim().split(/\s+/);

  // Find a tournament-name keyword and treat words from there to the end as
  // the name; words before are the city.
  let keywordIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (NAME_KEYWORDS.includes(tokens[i].replace(/[^A-Z]/g, ''))) {
      keywordIndex = i;
      break;
    }
  }
  if (keywordIndex === -1) return { name: null, city: null };

  // Walk left from the keyword to capture the full tournament name (4-10 tokens).
  let nameStart = Math.max(0, keywordIndex - 8);
  // Skip surface/draws junk: drop tokens that are 1-2 letter codes (H, CL, G, IH).
  while (nameStart < keywordIndex && /^[A-Z]{1,2}$/.test(tokens[nameStart])) {
    nameStart += 1;
  }
  const name = tokens.slice(nameStart, tokens.length).join(' ').replace(/\s{2,}/g, ' ').trim();

  // City: everything before the name, but trim digits/surface noise.
  const cityTokens = tokens.slice(0, nameStart).filter((t) => !/^[0-9]+$/.test(t) && !/^[A-Z]{1,2}$/.test(t));
  const city = cityTokens.length > 0 ? cityTokens.join(' ').trim() : null;

  return { name: name || null, city: city || (name ? name.split(' ')[0] : null) };
}

function extractSurface(window: string): string | null {
  // The surface letter sits right before the category token. Catch one or
  // two letters from the set {H, CL, G, IH} optionally followed by a comma.
  const m = window.match(/\b(IH|CL|H|G)\b\s*$/);
  if (!m) return null;
  switch (m[1].toUpperCase()) {
    case 'IH': return 'Hard';
    case 'CL': return 'Clay';
    case 'H': return 'Hard';
    case 'G': return 'Grass';
    default: return null;
  }
}

function parseCalendarPdfText(text: string, hintYear: number): CalendarTournament[] {
  const out: CalendarTournament[] = [];
  let pseudoCode = 9_000_000;
  const seen = new Set<string>();

  // Split into per-year sections; each PDF covers the current + next season.
  const yearHeaderRe = /(20\d{2})\s*CALENDAR/g;
  const yearMatches: Array<{ year: number; index: number }> = [];
  let yhMatch: RegExpExecArray | null;
  while ((yhMatch = yearHeaderRe.exec(text)) !== null) {
    yearMatches.push({ year: Number(yhMatch[1]), index: yhMatch.index });
  }
  if (yearMatches.length === 0) {
    yearMatches.push({ year: hintYear, index: 0 });
  }

  for (let s = 0; s < yearMatches.length; s += 1) {
    const sectionYear = yearMatches[s].year;
    const sectionStart = yearMatches[s].index;
    const sectionEnd = s + 1 < yearMatches.length ? yearMatches[s + 1].index : text.length;
    const sectionText = text.slice(sectionStart, sectionEnd);

    for (const hit of findAllCategoryHits(sectionText)) {
      const lookBack = sectionText.slice(Math.max(0, hit.start - 220), hit.start);
      const surface = extractSurface(lookBack);
      const { name, city } = extractNameAndCityBefore(lookBack);
      if (!name) continue;

      // Find the nearest date token within a slightly wider window.
      const dateWindow = sectionText.slice(Math.max(0, hit.start - 320), hit.start + 50);
      const startDate = extractDateNear(dateWindow, sectionYear);

      const canonical = NAME_TO_CANONICAL.get(name.toUpperCase().replace(/[^A-Z0-9]+/g, ''));
      const code = canonical ? Number(canonical.edition.protennislive_code ?? pseudoCode++) : pseudoCode++;

      const dedupKey = `${sectionYear}|${name.toUpperCase()}|${startDate ?? ''}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      out.push({
        code,
        citySlug: (canonical?.tournament.slug) ?? slugify(city ?? name, { lower: true, strict: true }),
        name: canonical?.tournament.name ?? name,
        city: canonical?.tournament.city ?? city ?? name,
        country: canonical?.tournament.country ?? null,
        startDate: startDate ?? null,
        endDate: null,
        level: hit.level,
        surface: surface ?? null,
        isChallenger: hit.level.toLowerCase().includes('challenger'),
      });
    }
  }

  return out;
}

async function scrapeCalendarPdf(pdfUrl: string, hintYear: number): Promise<CalendarTournament[]> {
  const buffer = await fetchPdfBuffer(pdfUrl);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
  const parsed = await pdfParse(buffer);
  return parseCalendarPdfText(parsed.text, hintYear);
}

function normalizeLevelString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.includes('grand slam')) return 'Grand Slam';
  if (t.includes('atp finals')) return 'ATP Finals';
  if (t.includes('next gen')) return 'Next Gen Finals';
  if (t.includes('masters 1000') || t === 'masters' || t.includes('atp 1000') || t === '1000') return 'ATP 1000';
  if (t.includes('atp 500') || t === '500') return 'ATP 500';
  if (t.includes('atp 250') || t === '250') return 'ATP 250';
  if (t.includes('challenger 175') || t === 'ch 175' || t.includes('chal 175')) return 'Challenger 175';
  if (t.includes('challenger 125') || t === 'ch 125') return 'Challenger 125';
  if (t.includes('challenger 100') || t === 'ch 100') return 'Challenger 100';
  if (t.includes('challenger 75') || t === 'ch 75') return 'Challenger 75';
  if (t.includes('challenger 50') || t === 'ch 50') return 'Challenger 50';
  if (t.includes('challenger')) return 'Challenger';
  return null;
}

function normalizeSurface(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes('hard')) return 'Hard';
  if (t.includes('clay')) return 'Clay';
  if (t.includes('grass')) return 'Grass';
  if (t.includes('carpet')) return 'Carpet';
  return null;
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickDate(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') {
      const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return null;
}

// Recursively walk a JSON-ish object looking for tournament-shaped sub-objects.
function harvestTournaments(
  obj: unknown,
  out: Map<number, CalendarTournament>,
  contextIsChallenger: boolean
): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestTournaments(item, out, contextIsChallenger);
    return;
  }
  const rec = obj as Record<string, unknown>;

  const idCandidate =
    pickString(rec, ['tournamentId', 'tournament_id', 'atpId', 'eventId', 'id']) ??
    null;
  const code = idCandidate && /^\d{2,6}$/.test(idCandidate) ? Number(idCandidate) : null;

  if (code !== null && code > 0) {
    const name = pickString(rec, ['title', 'tournamentTitle', 'name', 'tournamentName']);
    const city = pickString(rec, ['city', 'tournamentCity', 'venueCity']);
    const country = pickString(rec, ['country', 'tournamentCountry', 'countryName']);
    const startDate = pickDate(rec, ['startDate', 'tournamentStartDate', 'dateStart', 'start_date']);
    const endDate = pickDate(rec, ['endDate', 'tournamentEndDate', 'dateEnd', 'end_date']);
    const level = normalizeLevelString(
      pickString(rec, ['levelName', 'level', 'tournamentLevel', 'category', 'tournamentType'])
    );
    const surface = normalizeSurface(
      pickString(rec, ['surface', 'tournamentSurface', 'courtSurface'])
    );

    const existing = out.get(code);
    out.set(code, {
      code,
      citySlug: existing?.citySlug ?? (city ? slugify(city, { lower: true, strict: true }) : 'unknown'),
      name: existing?.name ?? name ?? undefined,
      city: existing?.city ?? city ?? undefined,
      country: existing?.country ?? country ?? null,
      startDate: existing?.startDate ?? startDate ?? null,
      endDate: existing?.endDate ?? endDate ?? null,
      level: existing?.level ?? level ?? null,
      surface: existing?.surface ?? surface ?? null,
      isChallenger: existing?.isChallenger || contextIsChallenger,
    });
  }

  for (const v of Object.values(rec)) harvestTournaments(v, out, contextIsChallenger);
}

async function scrapeOne(url: string, isChallenger: boolean, hintYear: number) {
  const html = await fetchHtml(url);
  const tournaments = new Map<number, CalendarTournament>();

  // Method 1: URL pattern matching for tournament refs
  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null) {
      const code = Number(m[2]);
      if (!tournaments.has(code)) {
        tournaments.set(code, {
          code,
          citySlug: m[1],
          isChallenger,
        });
      }
    }
  }

  // Method 2: walk __NEXT_DATA__ for richer metadata
  const ndMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ndMatch) {
    try {
      const nd = JSON.parse(ndMatch[1]);
      harvestTournaments(nd, tournaments, isChallenger);
    } catch {
      // Best-effort; URL pattern matches are still useful.
    }
  }

  // Method 3: the "20YY-YY Calendar PDF" button. The PDF is the authoritative
  // calendar so we always prefer its dates/level/surface when present.
  const pdfUrls = findCalendarPdfUrls(html, url);
  const pdfResults: Array<{ url: string; count: number; error?: string }> = [];
  for (const pdfUrl of pdfUrls) {
    try {
      const fromPdf = await scrapeCalendarPdf(pdfUrl, hintYear);
      pdfResults.push({ url: pdfUrl, count: fromPdf.length });
      for (const t of fromPdf) {
        const existing = tournaments.get(t.code);
        tournaments.set(t.code, {
          ...t,
          // PDF data wins over what we had from HTML guesses except for the
          // numeric tournament code which only comes from the URL/JSON path.
          ...(existing
            ? {
                code: existing.code,
                citySlug: existing.citySlug || t.citySlug,
                isChallenger: existing.isChallenger || t.isChallenger,
              }
            : {}),
        });
      }
    } catch (err) {
      pdfResults.push({ url: pdfUrl, count: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    url,
    count: tournaments.size,
    pdfsFound: pdfUrls,
    pdfResults,
    tournaments: Array.from(tournaments.values()),
  };
}

async function upsertTournament(t: CalendarTournament, year: number) {
  // Prefer canonical metadata if we have it.
  const canonical = CODE_TO_CANONICAL.get(t.code);
  const name =
    canonical?.tournament.name ??
    t.name ??
    (t.city ?? t.citySlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  const city = canonical?.tournament.city ?? t.city ?? name;
  const country = canonical?.tournament.country ?? t.country ?? null;
  const slug = canonical?.tournament.slug ?? slugify(name, { lower: true, strict: true, trim: true });

  // Derive year from start date when possible (Dec dates roll into next ATP season).
  const startDate = t.startDate ?? null;
  const editionYear = startDate ? getAtpEditionYearForStartDate(startDate, year) : year;
  const week = startDate ? (getAtpWeekForSeason(startDate, editionYear) ?? null) : null;
  const level = t.level ?? canonical?.edition.level ?? (t.isChallenger ? 'Challenger' : 'ATP 250');
  const surface = t.surface ?? canonical?.edition.surface ?? 'Hard';

  const tournamentResult = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set
       name = coalesce(tournaments.name, excluded.name),
       city = coalesce(tournaments.city, excluded.city),
       country = coalesce(tournaments.country, excluded.country),
       updated_at = now()
     returning id`,
    [slug, name, city, country]
  );
  const tournamentId = tournamentResult.rows[0].id;

  const sourceUrl = t.isChallenger
    ? `https://www.atptour.com/en/atp-challenger-tour/tournaments/${t.citySlug}/${t.code}/overview`
    : `https://www.atptour.com/en/tournaments/${t.citySlug}/${t.code}/overview`;

  // Don't clobber an existing real start_date with null. Status defaults to
  // 'held' so the schedule renders it; run-all + restore-historical-status
  // own the held/not_held flips.
  await pool.query(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, end_date, level, surface,
       indoor, source, source_url, status, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, false, 'atp_tour_calendar', $8, 'held', now())
     on conflict (tournament_id, year) do update set
       week = coalesce(excluded.week, tournament_editions.week),
       start_date = coalesce(excluded.start_date, tournament_editions.start_date),
       end_date = coalesce(excluded.end_date, tournament_editions.end_date),
       level = coalesce(excluded.level, tournament_editions.level),
       surface = coalesce(excluded.surface, tournament_editions.surface),
       source_url = case
         when tournament_editions.source_url ~ '/posting/\\d+/\\d+/' then tournament_editions.source_url
         else excluded.source_url
       end,
       updated_at = now()`,
    [tournamentId, editionYear, week, startDate, t.endDate ?? null, level, surface, sourceUrl]
  );

  return { slug, code: t.code, editionYear, week, level, surface, startDate, isChallenger: t.isChallenger };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? new Date().getFullYear());
  const dryRun = params.get('apply') === 'false';
  const debug = params.get('debug') === 'true';
  // ?pdfUrl=... lets the caller pin an explicit PDF (e.g. a known URL the
  // user pasted) instead of relying on discovery. Accepts a comma-separated
  // list so both the ATP Tour and Challenger PDFs can be passed at once.
  const explicitPdfUrls = (params.get('pdfUrl') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // ?skipHtml=true bypasses atptour.com page fetches (which currently 403)
  // and goes straight to PDF discovery + parsing. Defaults to true because
  // the PDFs are the canonical source and HTML pages have CF protection.
  const skipHtml = params.get('skipHtml') !== 'false';

  // Debug mode: download each PDF, return the first ~8KB of raw text so we
  // can see the actual layout and iterate on the row parser.
  if (debug) {
    const urls = explicitPdfUrls.length > 0 ? explicitPdfUrls : await discoverLatestCalendarPdfs(year);
    const samples: Array<{ url: string; textHead: string; textLength: number; error?: string }> = [];
    for (const url of urls) {
      try {
        const buffer = await fetchPdfBuffer(url);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
        const parsed = await pdfParse(buffer);
        const text = parsed.text ?? '';
        samples.push({ url, textHead: text.slice(0, 40000), textLength: text.length });
      } catch (err) {
        samples.push({ url, textHead: '', textLength: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({ ok: true, debug: true, year, samples });
  }

  const targets = [
    { url: 'https://www.atptour.com/en/tournaments', isChallenger: false },
    { url: 'https://www.atptour.com/en/atp-challenger-tour/calendar', isChallenger: true },
  ];

  const scrapeResults: Array<Awaited<ReturnType<typeof scrapeOne>>> = [];
  const scrapeErrors: Array<{ url: string; error: string }> = [];

  if (!skipHtml) {
    for (const t of targets) {
      try {
        scrapeResults.push(await scrapeOne(t.url, t.isChallenger, year));
      } catch (err) {
        scrapeErrors.push({ url: t.url, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Direct PDF path: works even when the HTML calendar pages are blocked.
  // explicit URLs first, then probe for the latest by date pattern.
  const directPdfUrls: string[] = [...explicitPdfUrls];
  const probedPdfUrls = explicitPdfUrls.length > 0 ? [] : await discoverLatestCalendarPdfs(year);
  directPdfUrls.push(...probedPdfUrls);

  const directPdfResults: Array<{ url: string; count: number; error?: string }> = [];
  for (const pdfUrl of directPdfUrls) {
    try {
      const fromPdf = await scrapeCalendarPdf(pdfUrl, year);
      directPdfResults.push({ url: pdfUrl, count: fromPdf.length });
      // Stitch into a pseudo-scrapeResult so the merge step below picks them up.
      scrapeResults.push({
        url: pdfUrl,
        count: fromPdf.length,
        pdfsFound: [pdfUrl],
        pdfResults: [{ url: pdfUrl, count: fromPdf.length }],
        tournaments: fromPdf,
      });
    } catch (err) {
      directPdfResults.push({ url: pdfUrl, count: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const merged = new Map<number, CalendarTournament>();
  for (const result of scrapeResults) {
    for (const t of result.tournaments) {
      const existing = merged.get(t.code);
      merged.set(t.code, {
        ...t,
        ...(existing ?? {}),
        // Prefer richer metadata, but keep the most-specific isChallenger.
        isChallenger: t.isChallenger || (existing?.isChallenger ?? false),
        name: existing?.name ?? t.name,
        city: existing?.city ?? t.city,
        country: existing?.country ?? t.country,
        startDate: existing?.startDate ?? t.startDate,
        endDate: existing?.endDate ?? t.endDate,
        level: existing?.level ?? t.level,
        surface: existing?.surface ?? t.surface,
      });
    }
  }

  if (merged.size === 0) {
    return NextResponse.json({
      ok: false,
      error:
        'No tournaments extracted. The HTML pages return 403 (Cloudflare); we also could not find or parse a media PDF for this year. Pass an explicit ?pdfUrl=https://www.atptour.com/-/media/files/calendar-pdfs/YEAR/...pdf with the link from the calendar button.',
      scrapeErrors,
      scrapeResultsCount: scrapeResults.map((r) => ({
        url: r.url,
        count: r.count,
        pdfsFound: r.pdfsFound,
        pdfResults: r.pdfResults,
      })),
      directPdfResults,
    }, { status: 502 });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      year,
      scrapeResultsCount: scrapeResults.map((r) => ({
        url: r.url,
        count: r.count,
        pdfsFound: r.pdfsFound,
        pdfResults: r.pdfResults,
      })),
      scrapeErrors,
      uniqueTournamentCount: merged.size,
      sample: Array.from(merged.values()).slice(0, 25),
    });
  }

  const upserted = [];
  const failed = [];
  for (const t of merged.values()) {
    try {
      upserted.push(await upsertTournament(t, year));
    } catch (err) {
      failed.push({ code: t.code, citySlug: t.citySlug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    year,
    scrapeResultsCount: scrapeResults.map((r) => ({
      url: r.url,
      count: r.count,
      pdfsFound: r.pdfsFound,
      pdfResults: r.pdfResults,
    })),
    scrapeErrors,
    directPdfResults,
    upsertedCount: upserted.length,
    failedCount: failed.length,
    sampleUpserted: upserted.slice(0, 25),
    failed,
  });
}

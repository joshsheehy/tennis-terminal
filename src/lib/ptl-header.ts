// Server-side ProTennisLive posting-header parser — the TypeScript port of
// scripts/scan-ptl-season.mjs's header logic, shared by the level-audit route.
// PTL posting headers are the ATP's own era-correct record: a 2022 posting
// says "ATP 250" / "Challenger 80" as it was IN 2022, which makes them the
// authority for auditing levels that survivorship-biased catalogues get wrong
// (Newport was ATP 250 through 2024, Challenger 125 from 2025).

type PositionedItem = { str: string; x: number; y: number; pageWidth: number };

export type PtlHeader = {
  name: string;
  city: string;
  country: string | null;
  startDate: string;
  endDate: string;
  level: string;
  surface: string;
  indoor: boolean;
  /** True when the level came from the tour money heuristic (ATP 250/500/1000
   * postings state TOTAL FINANCIAL COMMITMENT, not a category). */
  tourLevelHeuristic: boolean;
};

export type PtlHeaderResult = { header?: PtlHeader; skip?: string };

const PTL_FETCH_HEADERS = {
  'User-Agent': 'TennisCutsLevelAudit/1.0 (+https://tenniscuts.com)',
  Accept: 'application/pdf,*/*;q=0.8',
};

// Same row/column rebuild the season scanner uses: group items into rows by
// y, split each row into left/right columns so two-column headers don't merge.
function rebuildLines(items: PositionedItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PositionedItem[][] = [];
  for (const it of sorted) {
    const g = groups.find((ex) => Math.abs(ex[0].y - it.y) <= 2.5);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const lines: string[] = [];
  for (const g of groups) {
    const left = g.filter((i) => i.x < i.pageWidth * 0.52);
    const right = g.filter((i) => i.x >= i.pageWidth * 0.48);
    for (const side of [left, right]) {
      const text = side
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

async function firstPageLines(buffer: Buffer): Promise<string[]> {
  const pdfjsModule: unknown = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = pdfjsModule as {
    getDocument: (opts: {
      data: Uint8Array;
      isEvalSupported?: boolean;
      disableFontFace?: boolean;
      useSystemFonts?: boolean;
    }) => {
      promise: Promise<{
        getPage: (n: number) => Promise<{
          getViewport: (opts: { scale: number }) => { width: number };
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
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];
    for (const it of content.items) {
      const str = typeof it.str === 'string' ? it.str.trim() : '';
      if (!str || !Array.isArray(it.transform) || it.transform.length < 6) continue;
      items.push({ str, x: Number(it.transform[4] ?? 0), y: Number(it.transform[5] ?? 0), pageWidth: viewport.width });
    }
    return rebuildLines(items);
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "22-28 August 2022" | "31 January - 6 February 2022" | "7 July — 13 July 2025"
// (Challenger headers use an em-dash) → ISO start/end.
function parseDates(text: string): { start: string; end: string } | null {
  const halves = text.split(/[-–—]/).map((s) => s.trim());
  if (halves.length < 2) return null;
  const parse = (part: string, fallback: { month?: number; year?: number } | null) => {
    const m = part.match(/^(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = m[2] ? MONTHS[m[2].toLowerCase()] : fallback?.month;
    const yr = m[3] ? Number(m[3]) : fallback?.year;
    if (!day || !month || !yr) return null;
    return { day, month, year: yr };
  };
  const end = parse(halves[halves.length - 1], null);
  if (!end) return null;
  const start = parse(halves[0], end);
  if (!start) return null;
  const iso = (d: { day: number; month: number; year: number }) =>
    `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end) };
}

function moneyToNumber(line: string): number | null {
  const m = line.replace(/[, ]/g, '').match(/(\d{4,})/);
  return m ? Number(m[1]) : null;
}

const DATE_RE = /(\d{1,2}(?:\s+[A-Za-z]+)?(?:\s+\d{4})?\s*[-–—]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4})/;

export function parsePtlHeaderLines(lines: string[]): PtlHeaderResult {
  const head = lines.filter(Boolean).slice(0, 18);
  const joined = head.join(' | ');
  if (/ITF World Tennis Tour/i.test(joined)) return { skip: 'itf' };
  if (/Tournament Information Not Yet Available/i.test(joined)) return { skip: 'placeholder' };

  const name = head[0]?.trim();
  if (!name || /^CITY, COUNTRY/i.test(name)) return { skip: 'no-name' };

  let dates: { start: string; end: string } | null = null;
  let cityFromDateLine: string | null = null;
  for (const l of head.slice(1)) {
    const m = l.match(DATE_RE);
    if (!m || m.index === undefined) continue;
    const parsed = parseDates(m[1]);
    if (!parsed) continue;
    dates = parsed;
    const before = l.slice(0, m.index).trim();
    if (/^[^,]+,\s*\S/.test(before)) cityFromDateLine = before;
    break;
  }
  if (!dates) return { skip: 'no-dates' };

  const cityLine =
    cityFromDateLine ??
    head
      .slice(1)
      .find((l) => /^[^,]+,\s*[A-Za-z]/.test(l) && !DATE_RE.test(l) && !/^CITY, COUNTRY/i.test(l) && !/\d{3,}/.test(l));
  if (!cityLine) return { skip: 'no-city' };
  const [city, ...countryParts] = cityLine.split(',');
  const country = countryParts.join(',').trim() || null;

  const surfaceLine = head.find((l) => /^(Hard|Clay|Grass|Carpet)\b/i.test(l)) ?? joined;
  const surface = /clay/i.test(surfaceLine)
    ? 'Clay'
    : /grass/i.test(surfaceLine)
      ? 'Grass'
      : /carpet/i.test(surfaceLine)
        ? 'Carpet'
        : 'Hard';
  const indoor = /indoor/i.test(joined);

  const category = joined.match(/Challenger\s+(\d{2,3})\b/i);
  const isTour = /TOTAL FINANCIAL COMMITMENT/i.test(joined) && !category;
  const moneyLine = head.find((l) => /[$€£]\s*[\d,. ]{4,}/.test(l));
  const money = moneyLine ? moneyToNumber(moneyLine) : null;

  let level: string;
  if (category) level = `Challenger ${category[1]}`;
  else if (isTour) level = money != null && money >= 3_500_000 ? 'ATP 1000' : 'ATP 250';
  else return { skip: 'no-level' };

  return {
    header: {
      name: name.replace(/\s+\d{4}$/, '').trim(),
      city: city.trim(),
      country,
      startDate: dates.start,
      endDate: dates.end,
      level,
      surface,
      indoor,
      tourLevelHeuristic: isTour,
    },
  };
}

/** Fetch and parse the page-1 header of a posting's entry list. Tries mds.pdf
 * then qs.pdf (postings that only ran qualifying still carry the header). */
export async function fetchPtlHeader(
  year: number,
  code: string | number,
  fetchImpl: typeof fetch = fetch
): Promise<PtlHeaderResult> {
  const base = `https://www.protennislive.com/posting/${year}/${code}`;
  let lastError = 'no PDF found';
  for (const file of ['mds.pdf', 'qs.pdf']) {
    try {
      const res = await fetchImpl(`${base}/${file}`, { headers: PTL_FETCH_HEADERS, cache: 'no-store' });
      if (!res.ok) {
        lastError = `HTTP ${res.status} for ${file}`;
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const lines = await firstPageLines(buffer);
      const parsed = parsePtlHeaderLines(lines);
      // Headers that don't parse from mds may parse from qs (layout quirks);
      // only stop early on a definitive answer.
      if (parsed.header || parsed.skip === 'itf' || parsed.skip === 'placeholder') return parsed;
      lastError = parsed.skip ?? 'unparsed';
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 80) : String(err);
    }
  }
  return { skip: lastError };
}

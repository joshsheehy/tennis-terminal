type PdfParseResult = {
  text: string;
};

type PdfParseOptions = {
  pagerender?: (pageData: PdfPageProxy) => Promise<string>;
};

type PdfParseFunction = (buffer: Buffer, options?: PdfParseOptions) => Promise<PdfParseResult>;

type PdfTextItem = { str: string; transform: number[]; width?: number };
type PdfTextContent = { items: PdfTextItem[] };
type PdfPageProxy = {
  getTextContent: (opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }) => Promise<PdfTextContent>;
};

export type AcceptanceListSection =
  | 'direct_acceptance'
  | 'alternate'
  | 'wild_card'
  | 'qualifier'
  | 'special_exempt'
  | 'unknown';

export type AcceptanceListEntry = {
  position: number | null;
  rank: number | null;
  name: string;
  country: string | null;
  status: string | null;
  section: AcceptanceListSection;
  raw: string;
};

export type ParsedAcceptanceList = {
  parse_status: 'parsed' | 'missing_cutoff' | 'not_acceptance_list' | 'needs_ocr';
  tournament: string | null;
  list_date: string | null;
  ranking_date: string | null;
  original_cutoff_rank: number | null;
  direct_acceptances: AcceptanceListEntry[];
  alternates: AcceptanceListEntry[];
  wild_cards: AcceptanceListEntry[];
  qualifiers: AcceptanceListEntry[];
  special_exempts: AcceptanceListEntry[];
  entries: AcceptanceListEntry[];
  pdf_text_length: number;
};

const STATUS_CODES = new Set([
  'DA', 'PR', 'NG', 'JR', 'CO', 'SE', 'WC', 'Q', 'LL', 'ALT', 'AL', 'QWC', 'MDWC', 'QSE', 'MDS', 'QDS',
]);

const SECTION_PATTERNS: Array<[AcceptanceListSection, RegExp]> = [
  ['direct_acceptance', /^(?:main draw\s+)?direct acceptances?\b/i],
  ['alternate', /^alternates?\b/i],
  ['wild_card', /^wild cards?\b/i],
  ['qualifier', /^qualifiers?\b/i],
  ['special_exempt', /^special exempts?\b/i],
];

const STOP_SECTION_RE = /^(?:withdrawals?|released|entry information|tournament information|player information|notes?|atp supervisor|tournament director)\b/i;
const HEADER_RE = /official\s+player\s+acceptance\s+list/i;

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeRow(row: string): string {
  return row
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(name: string): string {
  return name
    .replace(/^\d+\s+(?=[A-Za-zÀ-ÿ])/u, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
    .trim();
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  const match = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (!match) return value;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function extractLabeledValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, 'i'));
  return match ? match[1].trim() : null;
}

function parseOriginalCutoff(text: string): number | null {
  const match = text.match(/original\s+cut\s*off\s*:?\s*(?:atp\s*)?(\d{1,5})\b/i);
  return match ? Number(match[1]) : null;
}

function parseHeaderDate(text: string): string | null {
  const lines = normalizeText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const rankingIdx = lines.findIndex((line) => /^ranking\s+date\b/i.test(line));
  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    if (i === rankingIdx) continue;
    const match = lines[i].match(/^date\s*:?\s*([0-9]{1,2}[\/.\-][0-9]{1,2}[\/.\-][0-9]{2,4})\b/i);
    if (match) return normalizeDate(match[1]);
  }
  return null;
}

function parseRankingDate(text: string): string | null {
  const value = extractLabeledValue(text, 'Ranking Date');
  const match = value?.match(/([0-9]{1,2}[\/.\-][0-9]{1,2}[\/.\-][0-9]{2,4})/);
  return normalizeDate(match?.[1] ?? null);
}

function isNoiseLine(line: string): boolean {
  return (
    line.length < 2 ||
    HEADER_RE.test(line) ||
    /^date\b/i.test(line) ||
    /^ranking\s+date\b/i.test(line) ||
    /^original\s+cut\s*off\b/i.test(line) ||
    /^(?:rank|ranking|player|player name|name|nat|nation|country|status|entry status|position|pos)(?:\s|$)/i.test(line)
  );
}

function sectionFromHeading(line: string): AcceptanceListSection | null {
  for (const [section, pattern] of SECTION_PATTERNS) {
    if (pattern.test(line)) return section;
  }
  return null;
}

function inferSectionFromStatus(status: string | null, current: AcceptanceListSection): AcceptanceListSection {
  const code = status?.toUpperCase() ?? null;
  if (code === 'WC' || code === 'MDWC' || code === 'QWC') return 'wild_card';
  if (code === 'Q') return 'qualifier';
  if (code === 'SE' || code === 'QSE') return 'special_exempt';
  if (code === 'ALT' || code === 'AL') return 'alternate';
  return current;
}

function parseStatusToken(token: string | undefined): string | null {
  if (!token) return null;
  const normalized = token.replace(/[()[\],.;:]/g, '').toUpperCase();
  return STATUS_CODES.has(normalized) ? normalized : null;
}

function parseColumns(columns: string[], section: AcceptanceListSection, raw: string): AcceptanceListEntry | null {
  const cleaned = columns.map(normalizeRow).filter(Boolean);
  if (cleaned.length < 2) return null;

  let country: string | null = null;
  let status: string | null = null;
  const numeric: Array<{ index: number; value: number }> = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const token = cleaned[i];
    if (/^\d{1,5}$/.test(token)) numeric.push({ index: i, value: Number(token) });
    if (!country && /^[A-Z]{3}$/.test(token) && !STATUS_CODES.has(token)) country = token;
    if (!status) status = parseStatusToken(token);
  }

  const nameCandidate = cleaned.find((token) => {
    if (/^\d{1,5}$/.test(token)) return false;
    if (/^[A-Z]{3}$/.test(token)) return false;
    if (parseStatusToken(token)) return false;
    return /[A-Za-zÀ-ÿ]/u.test(token) && !isNoiseLine(token) && !sectionFromHeading(token);
  });
  if (!nameCandidate) return null;

  const plausibleRanks = numeric.filter((item) => item.value >= 1 && item.value <= 5000);
  let position: number | null = null;
  let rank: number | null = null;

  if (plausibleRanks.length >= 2) {
    const first = plausibleRanks[0];
    const second = plausibleRanks[1];
    if (first.value <= 200 && second.value > first.value) {
      position = first.value;
      rank = second.value;
    } else {
      rank = first.value;
      if (second.value <= 200) position = second.value;
    }
  } else if (plausibleRanks.length === 1) {
    rank = plausibleRanks[0].value;
  }

  const inferredSection = inferSectionFromStatus(status, section);
  return {
    position,
    rank,
    name: cleanName(nameCandidate),
    country,
    status,
    section: inferredSection,
    raw,
  };
}

function parseFlatRow(line: string, section: AcceptanceListSection): AcceptanceListEntry | null {
  const raw = normalizeRow(line);
  if (!raw || isNoiseLine(raw) || sectionFromHeading(raw) || STOP_SECTION_RE.test(raw)) return null;

  const patterns: RegExp[] = [
    /^(\d{1,3})\s+(\d{1,5})\s+(.+?)\s+([A-Z]{3})(?:\s+([A-Z][A-Z0-9+/-]{0,5}))?$/,
    /^(\d{1,5})\s+(.+?)\s+([A-Z]{3})(?:\s+([A-Z][A-Z0-9+/-]{0,5}))?$/,
    /^(\d{1,3})\s+(.+?)\s+([A-Z]{3})\s+(\d{1,5})(?:\s+([A-Z][A-Z0-9+/-]{0,5}))?$/,
    /^(.+?)\s+([A-Z]{3})\s+(\d{1,5})(?:\s+([A-Z][A-Z0-9+/-]{0,5}))?$/,
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = raw.match(patterns[i]);
    if (!match) continue;

    let position: number | null = null;
    let rank: number | null = null;
    let name = '';
    let country: string | null = null;
    let status: string | null = null;

    if (i === 0) {
      position = Number(match[1]);
      rank = Number(match[2]);
      name = match[3];
      country = match[4];
      status = parseStatusToken(match[5]);
    } else if (i === 1) {
      rank = Number(match[1]);
      name = match[2];
      country = match[3];
      status = parseStatusToken(match[4]);
    } else if (i === 2) {
      position = Number(match[1]);
      name = match[2];
      country = match[3];
      rank = Number(match[4]);
      status = parseStatusToken(match[5]);
    } else {
      name = match[1];
      country = match[2];
      rank = Number(match[3]);
      status = parseStatusToken(match[4]);
    }

    if (rank !== null && (rank < 1 || rank > 5000)) continue;
    const cleanedName = cleanName(name);
    if (!/[A-Za-zÀ-ÿ]/u.test(cleanedName)) continue;

    return {
      position,
      rank,
      name: cleanedName,
      country,
      status,
      section: inferSectionFromStatus(status, section),
      raw,
    };
  }

  return null;
}

/**
 * One acceptance-list record: a name, a three-letter nation, a ranking, and an
 * optional status code. Names may carry a trailing entry-count marker such as
 * "(2)", so the name group is anything up to the nation column.
 */
// The status group needs a field-boundary lookahead. Without it, a line like
// "...\t304\tCaniato, Carlo Alberto\t..." matches the leading "C" of the next
// name as a status code and strips it, yielding "aniato, Carlo Alberto".
const RECORD_RE = /([^\t]+)\t([A-Z]{3})\t(\d{1,5})(?:\t([A-Z]{1,3})(?=\t|$))?/g;

/**
 * Split a line that holds several records side by side into one line each.
 *
 * These PDFs lay the list out in TWO COLUMNS, and text extraction flattens a
 * row into a single line carrying both:
 *
 *   "Michalski, Daniel\tPOL\t304\tCaniato, Carlo Alberto\tITA\t391"
 *
 * Read as one record that yields the left-hand player and silently discards the
 * right-hand one — half of every list. A Todi qualifying list parsed this way
 * returned 11 "wildcards" and no direct acceptances for a document holding
 * neither.
 *
 * Lines with a single record are returned untouched, so single-column
 * documents are unaffected.
 */
export function splitColumnarRow(line: string): string[] {
  // The metadata header carries tab-separated numbers too and must never be
  // read as a player row.
  if (/original\s+cut\s*off/i.test(line)) return [line];
  const matches = [...line.matchAll(RECORD_RE)];
  if (matches.length < 2) return [line];
  return matches.map((m) =>
    [m[1].trim(), m[2], m[3], ...(m[4] ? [m[4]] : [])].join('\t')
  );
}

function parseEntryRows(text: string): AcceptanceListEntry[] {
  const lines = text.replace(/\r/g, '\n').split('\n');
  const entries: AcceptanceListEntry[] = [];
  let section: AcceptanceListSection = 'unknown';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // The metadata header is tab-separated numbers and parses as a player row
    // otherwise, producing a phantom entrant named after a label.
    if (/original\s+cut\s*off/i.test(line)) continue;

    const headingSection = sectionFromHeading(normalizeRow(line));
    if (headingSection) {
      section = headingSection;
      continue;
    }
    if (STOP_SECTION_RE.test(normalizeRow(line))) {
      section = 'unknown';
      continue;
    }

    // A two-column row carries two players; each is classified separately.
    for (const part of splitColumnarRow(line)) {
      let entry: AcceptanceListEntry | null = null;
      if (part.includes('\t')) {
        entry = parseColumns(part.split('\t'), section, part);
      }
      if (!entry) entry = parseFlatRow(part, section);
      if (!entry) continue;

      if (entry.section === 'unknown' && !entry.status) continue;
      entries.push(entry);
    }
  }

  return entries;
}

function dedupeEntries(entries: AcceptanceListEntry[]): AcceptanceListEntry[] {
  const seen = new Set<string>();
  const result: AcceptanceListEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.section}|${entry.name.toLowerCase()}|${entry.rank ?? ''}|${entry.country ?? ''}|${entry.status ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function parseTournamentName(text: string): string | null {
  const lines = normalizeText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((line) => HEADER_RE.test(line));
  if (headerIdx === -1) return null;

  for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 8); i += 1) {
    const line = lines[i];
    if (isNoiseLine(line) || /^direct acceptances?\b/i.test(line)) continue;
    if (/^[A-Z0-9 .'&()\-/]{3,}$/i.test(line) && !/\d{1,2}[\/.\-]\d{1,2}/.test(line)) {
      return line;
    }
  }
  return null;
}

export function parseAcceptanceListText(text: string): ParsedAcceptanceList {
  const normalized = normalizeText(text);
  const isOfficialAcceptanceList = HEADER_RE.test(normalized);
  const originalCutoff = parseOriginalCutoff(normalized);
  const entries = dedupeEntries(parseEntryRows(text));

  let parseStatus: ParsedAcceptanceList['parse_status'];
  if (!normalized || normalized.length < 40) parseStatus = 'needs_ocr';
  else if (!isOfficialAcceptanceList) parseStatus = 'not_acceptance_list';
  else if (originalCutoff === null) parseStatus = 'missing_cutoff';
  else parseStatus = 'parsed';

  return {
    parse_status: parseStatus,
    tournament: parseTournamentName(normalized),
    list_date: parseHeaderDate(normalized),
    ranking_date: parseRankingDate(normalized),
    original_cutoff_rank: originalCutoff,
    direct_acceptances: entries.filter((entry) => entry.section === 'direct_acceptance'),
    alternates: entries.filter((entry) => entry.section === 'alternate'),
    wild_cards: entries.filter((entry) => entry.section === 'wild_card'),
    qualifiers: entries.filter((entry) => entry.section === 'qualifier'),
    special_exempts: entries.filter((entry) => entry.section === 'special_exempt'),
    entries,
    pdf_text_length: text.length,
  };
}

function layoutItemsToRowText(rawItems: PdfTextItem[]): string {
  const items = rawItems
    .map((item) => ({
      str: String(item.str ?? '').trim(),
      x: item.transform[4],
      y: item.transform[5],
    }))
    .filter((item) => item.str.length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Array<typeof items> = [];
  const Y_TOLERANCE = 2.5;
  let current: typeof items = [];
  let currentY: number | null = null;

  for (const item of items) {
    if (currentY === null || Math.abs(item.y - currentY) <= Y_TOLERANCE) {
      current.push(item);
      if (currentY === null) currentY = item.y;
    } else {
      rows.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length) rows.push(current);

  return rows
    .map((row) => row.sort((a, b) => a.x - b.x).map((item) => item.str).join('\t'))
    .join('\n');
}

function renderPageAsRows(pageData: PdfPageProxy): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((content) => layoutItemsToRowText(content.items));
}

function getPdfParse(): PdfParseFunction {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('pdf-parse') as PdfParseFunction;
}

async function extractRowTextWithPdfjs(buffer: Buffer): Promise<string> {
  const pdfjsModule: unknown = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = pdfjsModule as {
    getDocument: (opts: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean; useSystemFonts?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number }> }>;
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

  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = content.items
        .filter(
          (item): item is { str: string; transform: number[]; width?: number } =>
            typeof item.str === 'string' && Array.isArray(item.transform) && item.transform.length >= 6,
        )
        .map((item) => ({ str: item.str, transform: item.transform, width: item.width }));
      pages.push(layoutItemsToRowText(items));
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return pages.join('\n');
}

async function extractAcceptanceListTexts(buffer: Buffer): Promise<{ streamText: string; rowText: string }> {
  const pdfParse = getPdfParse();
  try {
    const streamText = (await pdfParse(buffer)).text;
    const rowText = (await pdfParse(buffer, { pagerender: renderPageAsRows })).text;
    return { streamText, rowText };
  } catch {
    const rowText = await extractRowTextWithPdfjs(buffer);
    return { streamText: rowText.replace(/\t/g, ' '), rowText };
  }
}

function scoreParse(parsed: ParsedAcceptanceList): number {
  let score = parsed.entries.length * 10;
  if (parsed.original_cutoff_rank !== null) score += 20;
  if (parsed.ranking_date) score += 5;
  if (parsed.list_date) score += 3;
  if (parsed.tournament) score += 2;
  return score;
}

function mergeParseResults(primary: ParsedAcceptanceList, secondary: ParsedAcceptanceList): ParsedAcceptanceList {
  const entries = dedupeEntries([...primary.entries, ...secondary.entries]);
  const originalCutoff = primary.original_cutoff_rank ?? secondary.original_cutoff_rank;
  const parseStatus: ParsedAcceptanceList['parse_status'] =
    primary.parse_status === 'not_acceptance_list' && secondary.parse_status === 'not_acceptance_list'
      ? 'not_acceptance_list'
      : originalCutoff !== null
        ? 'parsed'
        : primary.parse_status === 'needs_ocr' && secondary.parse_status === 'needs_ocr'
          ? 'needs_ocr'
          : 'missing_cutoff';

  return {
    parse_status: parseStatus,
    tournament: primary.tournament ?? secondary.tournament,
    list_date: primary.list_date ?? secondary.list_date,
    ranking_date: primary.ranking_date ?? secondary.ranking_date,
    original_cutoff_rank: originalCutoff,
    direct_acceptances: entries.filter((entry) => entry.section === 'direct_acceptance'),
    alternates: entries.filter((entry) => entry.section === 'alternate'),
    wild_cards: entries.filter((entry) => entry.section === 'wild_card'),
    qualifiers: entries.filter((entry) => entry.section === 'qualifier'),
    special_exempts: entries.filter((entry) => entry.section === 'special_exempt'),
    entries,
    pdf_text_length: Math.max(primary.pdf_text_length, secondary.pdf_text_length),
  };
}

export async function parseAcceptanceListPdfBuffer(buffer: Buffer): Promise<ParsedAcceptanceList> {
  const { streamText, rowText } = await extractAcceptanceListTexts(buffer);
  const streamParsed = parseAcceptanceListText(streamText);
  const rowParsed = parseAcceptanceListText(rowText);

  const [primary, secondary] = scoreParse(rowParsed) >= scoreParse(streamParsed)
    ? [rowParsed, streamParsed]
    : [streamParsed, rowParsed];
  return mergeParseResults(primary, secondary);
}

export async function fetchAndParseAcceptanceListPdf(url: string, timeoutMs = 8000): Promise<ParsedAcceptanceList> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Acceptance-list source must be an http(s) URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; TennisCuts/1.0; public acceptance-list importer)',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Acceptance-list fetch failed ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!contentType.toLowerCase().includes('pdf') && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Acceptance-list source did not return a PDF');
    }
    return parseAcceptanceListPdfBuffer(buffer);
  } finally {
    clearTimeout(timer);
  }
}

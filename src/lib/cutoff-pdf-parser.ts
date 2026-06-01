type PdfParseResult = {
  text: string;
  numpages?: number;
};

type PdfParseOptions = {
  pagerender?: (pageData: PdfPageProxy) => Promise<string>;
};

type PdfParseFunction = (buffer: Buffer, options?: PdfParseOptions) => Promise<PdfParseResult>;

// Minimal shape of the pdf.js objects we touch via pdf-parse's pagerender hook.
type PdfTextItem = { str: string; transform: number[]; width?: number };
type PdfTextContent = { items: PdfTextItem[] };
type PdfPageProxy = {
  getTextContent: (opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }) => Promise<PdfTextContent>;
};

// Reconstructs page text using each fragment's x/y coordinates instead of the
// content-stream order. pdf-parse's default renderer only uses the y coordinate,
// which scrambles 2D layouts like draw-sheet brackets and the bottom-left
// "LAST DIRECT ACCEPTANCE" box (the label and its value end up far apart).
// Here we group fragments into rows by y, split columns on large x-gaps, and
// emit each column segment as its own line so the value sits next to its label.
export function layoutItemsToText(rawItems: PdfTextItem[]): string {
  const items = rawItems
    .map((it) => ({
      str: String(it.str ?? ''),
      x: it.transform[4],
      y: it.transform[5],
      width: it.width ?? 0,
    }))
    .filter((it) => it.str.trim().length > 0);

  if (items.length === 0) return '';

  // Top-to-bottom (PDF y grows upward), then left-to-right.
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const Y_TOLERANCE = 3; // fragments within this y delta belong to the same visual row
  const COLUMN_GAP = 12; // x-gap larger than this starts a new column / logical line
  const SPACE_GAP = 1; // x-gap larger than this inside a column needs a space

  const rows: (typeof items)[] = [];
  let currentRow: typeof items = [];
  let rowY: number | null = null;
  for (const it of items) {
    if (rowY === null || Math.abs(it.y - rowY) <= Y_TOLERANCE) {
      currentRow.push(it);
      if (rowY === null) rowY = it.y;
    } else {
      rows.push(currentRow);
      currentRow = [it];
      rowY = it.y;
    }
  }
  if (currentRow.length) rows.push(currentRow);

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = row[0].str;
    let prevRight = row[0].x + row[0].width;
    for (let i = 1; i < row.length; i += 1) {
      const gap = row[i].x - prevRight;
      if (gap > COLUMN_GAP) {
        lines.push(line.trim());
        line = row[i].str;
      } else {
        line += (gap > SPACE_GAP ? ' ' : '') + row[i].str;
      }
      prevRight = row[i].x + row[i].width;
    }
    lines.push(line.trim());
  }

  return lines.filter((l) => l.length > 0).join('\n');
}

function renderPageWithLayout(pageData: PdfPageProxy): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((content) => layoutItemsToText(content.items));
}

export type ParsedOfficialPdfCutoff = {
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_name: string | null;
  raw_last_direct_acceptance: string | null;
  challenger_doubles_advanced_cut_rank: number | null;
  challenger_doubles_onsite_cut_rank: number | null;
  alternate_entries_count: number;
  lucky_loser_count: number;
  pdf_text_length: number;
};

type ParsedNameRank = {
  name: string;
  rank: number;
  raw: string;
};

function normalizePdfText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function getUsefulLines(text: string) {
  return normalizePdfText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanAcceptanceName(name: string) {
  return name
    .replace(/\s+/g, ' ')
    // Strip leading draw-position / ranking markers: "1 Fritz, Taylor" → "Fritz, Taylor";
    // "655 A. RUBLEV" → "A. RUBLEV"
    .replace(/^\d+\s+(?=[A-Z.])/, '')
    // Strip bracket seedings anywhere in the name: "A. RUBLEV [5]" → "A. RUBLEV"
    .replace(/\s*\[\d+\]\s*/g, ' ')
    .replace(/[\s,;:-]+$/, '')
    .trim();
}

function parseNameAndRank(line: string): ParsedNameRank | null {
  const normalized = line.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  // The optional `P` handles protected-ranking entries (e.g. "Kuznetsov, Andrey - P319"),
  // where the last direct acceptance used a protected ranking rather than a live one.
  const patterns = [
    /^(.+?)\s*-\s*P?(\d{1,5})\b/,
    /^(.+?)\s*\((\d{1,5})\)\s*$/,
    /^(.+?)\s+P?(\d{1,5})\s*$/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return {
        name: cleanAcceptanceName(match[1]),
        rank: Number(match[2]),
        raw: line.trim(),
      };
    }
  }

  return null;
}

function parseStandaloneRank(line: string) {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^\(?P?(\d{1,5})\)?$/);
  return match ? Number(match[1]) : null;
}

function isFooterHeading(line: string) {
  return /^(atp supervisor|tournament director|seeded players|seeded teams|alternates\/lucky losers|withdrawals|retirements|released)/i.test(line);
}

// Reject lines that pattern-match like "name + rank" but are actually scores,
// prize money, tournament titles, or section headings. These are the dominant
// false positives we saw in the 2024 import — e.g. "FIRST ROUND€ 745",
// "62 75" (a set score), "PRIZE MONEY (PER TEAM)SEEDED TEAMS 31",
// "Falkensteiner Punta Skala-Zadar Open 2024".
function isSpuriousNameRank(name: string, rank: number, raw: string): boolean {
  // ATP rankings cap well under 5000; a 4-digit number that looks like a year
  // is almost always a calendar year embedded in a tournament title.
  if (rank >= 1900 && rank <= 2100) return true;
  if (rank > 5000) return true;
  // Rank 1 or 2 is never a valid LDA — those players are top seeds, not last direct
  // acceptances. Values this low are almost always seed numbers or position markers
  // that leaked into the rank field.
  if (rank < 3) return true;

  const trimmedName = name.trim();
  if (trimmedName.length < 2) return true;

  // Names must contain at least one alphabetic character.
  if (!/[A-Za-zÀ-ÿ]/.test(trimmedName)) return true;

  // Pure-digit names are scores or counts, never player names.
  if (/^\d+$/.test(trimmedName)) return true;

  const upper = raw.toUpperCase();
  // Prize-money tells: currency symbols, the literal "PRIZE", or French "FIRST ROUND" with €.
  if (/[€$£]/.test(raw)) return true;
  if (/PRIZE\s*MONEY/.test(upper)) return true;
  if (/FIRST\s*ROUND/.test(upper) && /\d/.test(raw)) return true;
  if (/SEEDED\s*(PLAYERS|TEAMS)/.test(upper)) return true;
  if (/QUALIFIER/.test(upper) && rank < 100) return true; // "QUALIFIER 0" / "QUALIFIER 4" headings.
  // Draw-round headings that appear near prize-money tables.
  if (/^(QUARTER|SEMI)[\s-]FINALIST/i.test(trimmedName)) return true;
  // The label line itself captured as a player name.
  if (/^LAST\s+DIRECT\s+ACCEPTANCE/i.test(trimmedName)) return true;
  // Madrid-style combined-ranking notation: "D+D 88; S+S 414".
  if (/\b[A-Z]\+[A-Z]\b/.test(raw)) return true;
  // Entry-category codes, not player names: WC (wildcard), LL (lucky loser), etc.
  if (/^(WC|LL|SE|PR|WR|Alt)$/i.test(trimmedName)) return true;

  // Tennis set scores like "62 75", "64 26 10-8", "76(5) 64".
  // Strip parentheses/dashes and check if every token is a 2-digit short score.
  const tokens = raw.replace(/[()\-]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((t) => /^\d{1,2}$/.test(t) && Number(t) <= 79)) {
    return true;
  }

  return false;
}

// Some draw sheets print the cut value on the SAME line as the label, e.g.
//   "LAST DIRECT ACCEPTANCE: M.Bortolotti/M.Romios - 215ATP SUPERVISOR..."  (Gstaad doubles)
//   "LAST DIRECT ACCEPTANCE AT DEADLINE D.Schwartzman - 111 LAST DIRECT ..."  (Cordoba singles)
// The trailing text is often glued straight onto the rank ("215ATP"), so the rank
// is deliberately NOT anchored to a word boundary here.
function parseInlineLastDirectAcceptance(labelLine: string): ParsedNameRank | null {
  const normalized = labelLine.replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const afterLabel = normalized.match(
    /last direct acceptance(?:\s+(?:at deadline|in draw))?\s*:?\s*(.+)/i
  );
  if (!afterLabel) return null;
  const tail = afterLabel[1].trim();
  if (!tail) return null;

  const nameRank = tail.match(/^(.+?)\s*-\s*P?(\d{1,5})/);
  if (!nameRank) return null;

  const candidate = {
    name: cleanAcceptanceName(nameRank[1]),
    rank: Number(nameRank[2]),
    raw: tail,
  };
  return isSpuriousNameRank(candidate.name, candidate.rank, candidate.raw) ? null : candidate;
}

function parseLastDirectAcceptance(lines: string[]): ParsedNameRank | null {
  const index = lines.findIndex((line) => /last direct acceptance/i.test(line));

  if (index === -1) return null;

  // Prefer an inline value on the label line itself, before scanning following rows.
  const inline = parseInlineLastDirectAcceptance(lines[index]);
  if (inline) return inline;

  // Real LDA values land within the first few rows after the label — either on
  // the very next line, or after a single blank/punctuation row. Scanning 12
  // rows ahead lets the parser pick up unrelated text like seed brackets or
  // draw-position numbers when the label exists but its value is blank, which
  // is the bug behind the spurious single-digit cuts on Tokyo 2024 and Paris
  // 2025. Tight window (4) keeps the legitimate cases working while killing
  // the long-range false positives.
  for (let offset = 1; offset <= 4; offset += 1) {
    const line = lines[index + offset];
    if (!line) continue;
    if (isFooterHeading(line)) continue;

    const parsed = parseNameAndRank(line);
    if (parsed && !isSpuriousNameRank(parsed.name, parsed.rank, parsed.raw)) {
      return parsed;
    }

    const nextLine = lines[index + offset + 1];
    const rankFromNextLine = nextLine ? parseStandaloneRank(nextLine) : null;

    if (rankFromNextLine !== null && !isFooterHeading(nextLine)) {
      const candidate = {
        name: cleanAcceptanceName(line),
        rank: rankFromNextLine,
        raw: `${line.trim()} ${nextLine.trim()}`,
      };
      if (!isSpuriousNameRank(candidate.name, candidate.rank, candidate.raw)) {
        return candidate;
      }
    }
  }

  return null;
}

function parseChallengerDoublesCuts(lines: string[], lastDirectAcceptanceIndex: number) {
  const extractCuts = (text: string) => {
    const normalized = text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    const advancedMatch = normalized.match(/\badv(?:anc(?:e(?:d)?)?)?\.*\s*[:\-]?\s*(\d{1,5})\b/i);
    const onsiteMatch = normalized.match(/\bon[-\s]?site\.*\s*[:\-]?\s*(\d{1,5})\b/i);
    return {
      advanced: advancedMatch ? Number(advancedMatch[1]) : null,
      onsite: onsiteMatch ? Number(onsiteMatch[1]) : null,
    };
  };

  // Try a window around the LDA label first (wider window than before to handle
  // draw-sheet PDFs where adv/onsite appear several lines after the label).
  if (lastDirectAcceptanceIndex !== -1) {
    const windowResult = extractCuts(
      lines.slice(lastDirectAcceptanceIndex, lastDirectAcceptanceIndex + 20).join(' ')
    );
    if (windowResult.advanced !== null || windowResult.onsite !== null) return windowResult;
  }

  // Fall back to a full-text scan — covers cases where the LDA label is absent
  // (index === -1) or where adv/onsite appear outside the window in layout order.
  return extractCuts(lines.join(' '));
}

function parseAlternateEntriesCount(lines: string[]): { alternate_count: number; lucky_loser_count: number } {
  // Matches both parenthesis and square-bracket notation: (Alt), [Alt], (LL), [LL].
  const ALT_RE = /(?:\(|\[)Alt(?:\)|\])/i;
  const LL_RE = /(?:\(|\[)LL(?:\)|\])/i;
  const EITHER_RE = /(?:\(|\[)(?:Alt|LL)(?:\)|\])/gi;

  const sectionStart = lines.findIndex((line) => /alternates\/lucky losers/i.test(line));

  if (sectionStart === -1) {
    const fullText = lines.join(' ');
    const matches = fullText.match(EITHER_RE) ?? [];
    return {
      alternate_count: matches.filter((m) => ALT_RE.test(m)).length,
      lucky_loser_count: matches.filter((m) => LL_RE.test(m)).length,
    };
  }

  let alternate_count = 0;
  let lucky_loser_count = 0;

  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^(withdrawals|retirements|retirements\/w\.o\.|atp supervisor|released|seeded players|seeded teams)/i.test(line)) {
      break;
    }

    if (ALT_RE.test(line)) {
      alternate_count += 1;
    } else if (LL_RE.test(line)) {
      lucky_loser_count += 1;
    }
  }

  return { alternate_count, lucky_loser_count };
}

export function parseOfficialPdfCutoffText(text: string): ParsedOfficialPdfCutoff {
  const lines = getUsefulLines(text);
  const lastDirectAcceptanceIndex = lines.findIndex((line) => /last direct acceptance/i.test(line));
  const lastDirect = parseLastDirectAcceptance(lines);
  const challengerDoublesCuts = parseChallengerDoublesCuts(lines, lastDirectAcceptanceIndex);
  const { alternate_count, lucky_loser_count } = parseAlternateEntriesCount(lines);

  return {
    last_direct_acceptance_rank: lastDirect?.rank ?? null,
    last_direct_acceptance_name: lastDirect?.name ?? null,
    raw_last_direct_acceptance: lastDirect?.raw ?? null,
    challenger_doubles_advanced_cut_rank: challengerDoublesCuts.advanced,
    challenger_doubles_onsite_cut_rank: challengerDoublesCuts.onsite,
    alternate_entries_count: alternate_count,
    lucky_loser_count,
    pdf_text_length: text.length,
  };
}

async function fetchPdfBuffer(url: string, timeoutMs = 4000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; TennisTerminalBot/1.0)',
        referer: 'https://www.protennislive.com/',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`fetch failed ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// Query the Wayback CDX API for snapshot timestamps of a URL for a given ATP season year.
// The window starts in October of the prior year because early-season PDFs (week 1-2
// tournaments like Brisbane, Adelaide, Auckland) are often published in December and would
// be missed by a strict Jan 1 start. The URL already encodes the target year (/posting/YYYY/)
// so a snapshot from Dec of the prior year is still the correct-year PDF.
async function queryCDXTimestamps(pdfUrl: string, year: number): Promise<string[]> {
  const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pdfUrl)}&output=json&limit=20&from=${year - 1}1001&to=${year}1231&filter=statuscode:200&fl=timestamp&collapse=digest`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(cdx, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return [];
    const rows = await response.json() as string[][];
    return rows.slice(1).map((r) => r[0]).reverse(); // skip header row, most-recent first
  } catch {
    return [];
  }
}

// Fetch a PDF from the Wayback Machine.
// CDX API is tried first to find snapshots within the target season window.
// Falls back to fixed bi-monthly guesses (including prior-Dec) when CDX returns nothing.
// Uses the "if_" modifier so we get the raw file, not the Wayback UI wrapper.
async function fetchViaWayback(pdfUrl: string): Promise<Buffer | null> {
  const yearMatch = pdfUrl.match(/\/posting\/(\d{4})\//);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);

  const cdxTimestamps = await queryCDXTimestamps(pdfUrl, year);
  const guessTimestamps = [
    `${year - 1}1201`, `${year - 1}1101`,
    `${year}0201`, `${year}0401`, `${year}0601`,
    `${year}0801`, `${year}1001`, `${year}1201`,
  ];
  const timestamps = [...new Set([...cdxTimestamps, ...guessTimestamps])];

  const results = await Promise.all(
    timestamps.map((ts) =>
      fetchPdfBuffer(`https://web.archive.org/web/${ts}000000if_/${pdfUrl}`, 5000)
        .catch(() => null)
    )
  );
  return results.find((r): r is Buffer => r !== null) ?? null;
}

// archiveFirst=true: try Wayback before PTL.
// Required for historical years — PTL returns HTTP 200 with the current-year draw at old
// year paths, so a live fetch silently gives the wrong data with no error to trigger fallback.
async function fetchPdfBufferWithFallback(pdfUrl: string, archiveFirst: boolean): Promise<Buffer> {
  if (archiveFirst) {
    const archived = await fetchViaWayback(pdfUrl);
    if (archived) return archived;
    return fetchPdfBuffer(pdfUrl); // PTL as last resort
  }
  try {
    return await fetchPdfBuffer(pdfUrl);
  } catch {
    const archived = await fetchViaWayback(pdfUrl);
    if (!archived) throw new Error(`PDF unavailable (PTL + Wayback both failed) for ${pdfUrl}`);
    return archived;
  }
}

function getPdfParse(): PdfParseFunction {
  // pdf-parse has no bundled TypeScript types in this project.
  // Using require here avoids adding another dependency just for this parser.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('pdf-parse') as PdfParseFunction;
}

function hasAnyRank(parsed: ParsedOfficialPdfCutoff): boolean {
  return (
    parsed.last_direct_acceptance_rank !== null ||
    parsed.challenger_doubles_advanced_cut_rank !== null ||
    parsed.challenger_doubles_onsite_cut_rank !== null
  );
}

// Merge two parse results, preferring non-null values from each pass.
// This handles draw-sheet PDFs where stream order finds the advanced cut but
// misses onsite (because adv/onsite appear near each other on the page but
// stream order separates them), while layout finds both.
function mergeResults(stream: ParsedOfficialPdfCutoff, layout: ParsedOfficialPdfCutoff): ParsedOfficialPdfCutoff {
  return {
    last_direct_acceptance_rank: stream.last_direct_acceptance_rank ?? layout.last_direct_acceptance_rank,
    last_direct_acceptance_name: stream.last_direct_acceptance_name ?? layout.last_direct_acceptance_name,
    raw_last_direct_acceptance: stream.raw_last_direct_acceptance ?? layout.raw_last_direct_acceptance,
    challenger_doubles_advanced_cut_rank: stream.challenger_doubles_advanced_cut_rank ?? layout.challenger_doubles_advanced_cut_rank,
    challenger_doubles_onsite_cut_rank: stream.challenger_doubles_onsite_cut_rank ?? layout.challenger_doubles_onsite_cut_rank,
    alternate_entries_count: Math.max(stream.alternate_entries_count, layout.alternate_entries_count),
    lucky_loser_count: Math.max(stream.lucky_loser_count, layout.lucky_loser_count),
    pdf_text_length: stream.pdf_text_length,
  };
}

export async function fetchAndParseOfficialPdfCutoff(
  pdfUrl: string,
  archiveFirst = false,
): Promise<ParsedOfficialPdfCutoff> {
  const buffer = await fetchPdfBufferWithFallback(pdfUrl, archiveFirst);
  const pdfParse = getPdfParse();

  // First pass: default stream-order extraction (proven for entry-list PDFs).
  const streamText = (await pdfParse(buffer)).text;
  const streamParsed = parseOfficialPdfCutoffText(streamText);

  // Always run layout pass too, so we can merge. Draw-sheet PDFs often have the
  // stream order find the advanced cut but miss onsite (they appear close on page
  // but far apart in content-stream order). Layout finds both; merging is safe.
  const layoutText = (await pdfParse(buffer, { pagerender: renderPageWithLayout })).text;
  const layoutParsed = parseOfficialPdfCutoffText(layoutText);

  if (!hasAnyRank(streamParsed) && !hasAnyRank(layoutParsed)) return streamParsed;
  return mergeResults(streamParsed, layoutParsed);
}

// Returns both extractions alongside the parsed results, for debugging why a
// particular PDF did or did not yield a cut.
export async function fetchOfficialPdfDebug(
  pdfUrl: string,
  archiveFirst = false,
): Promise<{
  text: string;
  lines: string[];
  parsed: ParsedOfficialPdfCutoff;
  layoutText: string;
  layoutLines: string[];
  layoutParsed: ParsedOfficialPdfCutoff;
}> {
  const buffer = await fetchPdfBufferWithFallback(pdfUrl, archiveFirst);
  const pdfParse = getPdfParse();

  const streamText = (await pdfParse(buffer)).text;
  const layoutText = (await pdfParse(buffer, { pagerender: renderPageWithLayout })).text;

  return {
    text: streamText,
    lines: getUsefulLines(streamText),
    parsed: parseOfficialPdfCutoffText(streamText),
    layoutText,
    layoutLines: getUsefulLines(layoutText),
    layoutParsed: parseOfficialPdfCutoffText(layoutText),
  };
}

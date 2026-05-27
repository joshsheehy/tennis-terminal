type PdfParseResult = {
  text: string;
  numpages?: number;
};

type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>;

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
    .replace(/[\s,;:-]+$/, '')
    .trim();
}

function parseNameAndRank(line: string): ParsedNameRank | null {
  const normalized = line.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  const patterns = [
    /^(.+?)\s*-\s*(\d{1,5})\b/,
    /^(.+?)\s*\((\d{1,5})\)\s*$/,
    /^(.+?)\s+(\d{1,5})\s*$/,
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
  const match = normalized.match(/^\(?(\d{1,5})\)?$/);
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
  if (rank < 1) return true;

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

  // Tennis set scores like "62 75", "64 26 10-8", "76(5) 64".
  // Strip parentheses/dashes and check if every token is a 2-digit short score.
  const tokens = raw.replace(/[()\-]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((t) => /^\d{1,2}$/.test(t) && Number(t) <= 79)) {
    return true;
  }

  return false;
}

function parseLastDirectAcceptance(lines: string[]): ParsedNameRank | null {
  const index = lines.findIndex((line) => /last direct acceptance/i.test(line));

  if (index === -1) return null;

  for (let offset = 1; offset <= 12; offset += 1) {
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
  if (lastDirectAcceptanceIndex === -1) {
    return {
      advanced: null,
      onsite: null,
    };
  }

  const windowText = lines.slice(lastDirectAcceptanceIndex, lastDirectAcceptanceIndex + 12).join(' ');
  const normalized = windowText
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const advancedMatch = normalized.match(/\badv(?:anced)?\.*\s*[:\-]?\s*(\d{1,5})\b/i);
  const onsiteMatch = normalized.match(/\bon[-\s]?site\.*\s*[:\-]?\s*(\d{1,5})\b/i);

  return {
    advanced: advancedMatch ? Number(advancedMatch[1]) : null,
    onsite: onsiteMatch ? Number(onsiteMatch[1]) : null,
  };
}

function parseAlternateEntriesCount(lines: string[]): { alternate_count: number; lucky_loser_count: number } {
  const sectionStart = lines.findIndex((line) => /alternates\/lucky losers/i.test(line));

  if (sectionStart === -1) {
    const fullText = lines.join(' ');
    const matches = fullText.match(/\((?:LL|Alt)\)/gi) ?? [];
    return {
      alternate_count: matches.filter((m) => /alt/i.test(m)).length,
      lucky_loser_count: matches.filter((m) => /^(ll)$/i.test(m.replace(/[()]/g, ''))).length,
    };
  }

  let alternate_count = 0;
  let lucky_loser_count = 0;

  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^(withdrawals|retirements|retirements\/w\.o\.|atp supervisor|released|seeded players|seeded teams)/i.test(line)) {
      break;
    }

    if (/\(Alt\)/i.test(line)) {
      alternate_count += 1;
    } else if (/\(LL\)/i.test(line)) {
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
export async function fetchAndParseOfficialPdfCutoff(
  pdfUrl: string,
  archiveFirst = false,
): Promise<ParsedOfficialPdfCutoff> {
  let buffer: Buffer;

  if (archiveFirst) {
    const archived = await fetchViaWayback(pdfUrl);
    if (archived) {
      buffer = archived;
    } else {
      buffer = await fetchPdfBuffer(pdfUrl); // PTL as last resort
    }
  } else {
    try {
      buffer = await fetchPdfBuffer(pdfUrl);
    } catch {
      const archived = await fetchViaWayback(pdfUrl);
      if (!archived) throw new Error(`PDF unavailable (PTL + Wayback both failed) for ${pdfUrl}`);
      buffer = archived;
    }
  }

  // pdf-parse has no bundled TypeScript types in this project.
  // Using require here avoids adding another dependency just for this parser.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as PdfParseFunction;
  const parsedPdf = await pdfParse(buffer);

  return parseOfficialPdfCutoffText(parsedPdf.text);
}

// Returns the raw extracted PDF text alongside the parsed result, for debugging
// why a particular PDF did not yield a cut. Uses the same fetch path as the parser.
export async function fetchOfficialPdfDebug(
  pdfUrl: string,
  archiveFirst = false,
): Promise<{ text: string; lines: string[]; parsed: ParsedOfficialPdfCutoff }> {
  let buffer: Buffer;
  if (archiveFirst) {
    const archived = await fetchViaWayback(pdfUrl);
    buffer = archived ?? (await fetchPdfBuffer(pdfUrl));
  } else {
    try {
      buffer = await fetchPdfBuffer(pdfUrl);
    } catch {
      const archived = await fetchViaWayback(pdfUrl);
      if (!archived) throw new Error(`PDF unavailable (PTL + Wayback both failed) for ${pdfUrl}`);
      buffer = archived;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as PdfParseFunction;
  const parsedPdf = await pdfParse(buffer);

  return {
    text: parsedPdf.text,
    lines: getUsefulLines(parsedPdf.text),
    parsed: parseOfficialPdfCutoffText(parsedPdf.text),
  };
}

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
    .replace(/\u00a0/g, ' ')
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

function parseLastDirectAcceptance(lines: string[]): ParsedNameRank | null {
  const index = lines.findIndex((line) => /last direct acceptance/i.test(line));

  if (index === -1) return null;

  for (let offset = 1; offset <= 12; offset += 1) {
    const line = lines[index + offset];
    if (!line) continue;
    if (isFooterHeading(line)) continue;

    const parsed = parseNameAndRank(line);
    if (parsed) return parsed;

    const nextLine = lines[index + offset + 1];
    const rankFromNextLine = nextLine ? parseStandaloneRank(nextLine) : null;

    if (rankFromNextLine !== null && !isFooterHeading(nextLine)) {
      return {
        name: cleanAcceptanceName(line),
        rank: rankFromNextLine,
        raw: `${line.trim()} ${nextLine.trim()}`,
      };
    }
  }

  return null;
}

function parseChallengerDoublesCuts(rawLastDirectAcceptance: string | null) {
  if (!rawLastDirectAcceptance) {
    return {
      advanced: null,
      onsite: null,
    };
  }

  const normalized = rawLastDirectAcceptance
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const advancedMatch = normalized.match(/\badv(?:anced)?\.?\s*(\d{1,5})\b/i);
  const onsiteMatch = normalized.match(/\bon[-\s]?site\.?\s*(\d{1,5})\b/i);

  return {
    advanced: advancedMatch ? Number(advancedMatch[1]) : null,
    onsite: onsiteMatch ? Number(onsiteMatch[1]) : null,
  };
}

function parseAlternateEntriesCount(lines: string[]) {
  const sectionStart = lines.findIndex((line) => /alternates\/lucky losers/i.test(line));

  if (sectionStart === -1) {
    const fullText = lines.join(' ');
    return (fullText.match(/\((?:LL|Alt)\)/gi) ?? []).length;
  }

  let count = 0;

  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^(withdrawals|retirements|retirements\/w\.o\.|atp supervisor|released|seeded players|seeded teams)/i.test(line)) {
      break;
    }

    if (/\((?:LL|Alt)\)/i.test(line)) {
      count += 1;
    }
  }

  return count;
}

export function parseOfficialPdfCutoffText(text: string): ParsedOfficialPdfCutoff {
  const lines = getUsefulLines(text);
  const lastDirect = parseLastDirectAcceptance(lines);
  const challengerDoublesCuts = parseChallengerDoublesCuts(lastDirect?.raw ?? null);

  return {
    last_direct_acceptance_rank: lastDirect?.rank ?? null,
    last_direct_acceptance_name: lastDirect?.name ?? null,
    raw_last_direct_acceptance: lastDirect?.raw ?? null,
    challenger_doubles_advanced_cut_rank: challengerDoublesCuts.advanced,
    challenger_doubles_onsite_cut_rank: challengerDoublesCuts.onsite,
    alternate_entries_count: parseAlternateEntriesCount(lines),
    pdf_text_length: text.length,
  };
}

export async function fetchAndParseOfficialPdfCutoff(
  pdfUrl: string
): Promise<ParsedOfficialPdfCutoff> {
  const response = await fetch(pdfUrl, {
    headers: {
      accept: 'application/pdf,*/*;q=0.8',
      'user-agent': 'TennisTerminalPdfParser/0.1',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`PDF fetch failed ${response.status} for ${pdfUrl}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // pdf-parse has no bundled TypeScript types in this project.
  // Using require here avoids adding another dependency just for this parser.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as PdfParseFunction;
  const parsedPdf = await pdfParse(buffer);

  return parseOfficialPdfCutoffText(parsedPdf.text);
}

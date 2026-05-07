type PdfParseResult = {
  text: string;
  numpages?: number;
};

type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>;

export type ParsedOfficialPdfCutoff = {
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_name: string | null;
  raw_last_direct_acceptance: string | null;
  alternate_entries_count: number;
  pdf_text_length: number;
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

function parseNameAndRank(line: string) {
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

function parseLastDirectAcceptance(lines: string[]) {
  const index = lines.findIndex((line) => /last direct acceptance/i.test(line));

  if (index === -1) return null;

  for (let offset = 1; offset <= 12; offset += 1) {
    const line = lines[index + offset];
    if (!line) continue;

    if (/^(atp supervisor|tournament director|seeded players|seeded teams|alternates\/lucky losers|withdrawals|retirements|released)/i.test(line)) {
      continue;
    }

    const parsed = parseNameAndRank(line);
    if (parsed) return parsed;
  }

  return null;
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

  return {
    last_direct_acceptance_rank: lastDirect?.rank ?? null,
    last_direct_acceptance_name: lastDirect?.name ?? null,
    raw_last_direct_acceptance: lastDirect?.raw ?? null,
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

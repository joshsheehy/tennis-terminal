export type PublicEntryMarker = 'active' | 'in' | 'out' | 'struck';

export type PublicEntryRow = {
  name: string;
  country: string | null;
  entryRank: number | null;
  entryCode: string | null;
  marker: PublicEntryMarker;
  rawText: string;
};

export type PublicEntryTournament = {
  slug: string;
  sourceHeading: string;
  main: PublicEntryRow[];
  alternates: PublicEntryRow[];
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function textOnly(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function slugFromHeading(heading: string): string | null {
  const text = textOnly(heading).toLowerCase();
  if (text.includes('cancun')) return 'cancun';
  if (text.includes('quebec')) return 'quebec-city';
  if (text.includes('kingston')) return 'kingston';
  if (text.includes('praga') || text.includes('prague')) return 'prague';
  if (text.includes('roehampton')) return 'roehampton';
  if (text.includes('sion')) return 'sion';
  return null;
}

// The source writes its line breaks as `<br data-start="1751" data-end="1754">`.
// A `<br\s*\/?>` pattern does not match a tag carrying attributes, so every
// player in a paragraph ran together into a single line and the whole draw came
// back as one row whose "name" was the entire list. Match the tag, not the
// shorthand spelling of it.
function splitHtmlLines(value: string): string[] {
  return value
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr)>/gi, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// A player name is a handful of words. Anything carrying digits, or running far
// past the longest real name, is a run-together line rather than a person —
// reject it instead of rendering a paragraph as one entrant.
const MAX_NAME_LENGTH = 48;

function isPlausibleName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !/\d/.test(name);
}

function parseRow(lineHtml: string): PublicEntryRow | null {
  const struck = /<del\b/i.test(lineHtml);
  let rawText = textOnly(lineHtml);
  if (!rawText || /^alternates?$/i.test(rawText)) return null;

  let marker: PublicEntryMarker = struck ? 'struck' : 'active';
  if (/^OUT\b/i.test(rawText)) {
    marker = 'out';
    rawText = rawText.replace(/^OUT\s*/i, '').trim();
  } else if (/^IN\b/i.test(rawText)) {
    marker = 'in';
    rawText = rawText.replace(/^IN\s*/i, '').trim();
  }

  const entryCodeMatch = rawText.match(/\s+\(([^)]+)\)\s*$/);
  const entryCode = entryCodeMatch?.[1]?.trim() ?? null;
  const withoutCode = entryCodeMatch ? rawText.slice(0, entryCodeMatch.index).trim() : rawText;

  const ranked = withoutCode.match(/^(.*?)\s+([A-Z]{3})\s+(\d+)$/u);
  if (ranked && isPlausibleName(ranked[1].trim())) {
    return {
      name: ranked[1].trim(),
      country: ranked[2],
      entryRank: Number(ranked[3]),
      entryCode,
      marker,
      rawText: textOnly(lineHtml),
    };
  }

  // Some mirrors occasionally omit a country code. Keep the row rather than
  // throwing it away; provenance is more important than guessing the country.
  const rankOnly = withoutCode.match(/^(.*?)\s+(\d+)$/u);
  if (rankOnly && isPlausibleName(rankOnly[1].trim())) {
    return {
      name: rankOnly[1].trim(),
      country: null,
      entryRank: Number(rankOnly[2]),
      entryCode,
      marker,
      rawText: textOnly(lineHtml),
    };
  }

  // Junior/college rows can have no ATP rank. Preserve them as long as a name
  // and three-letter country are explicit.
  const unranked = withoutCode.match(/^(.*?)\s+([A-Z]{3})$/u);
  if (unranked && isPlausibleName(unranked[1].trim())) {
    return {
      name: unranked[1].trim(),
      country: unranked[2],
      entryRank: null,
      entryCode,
      marker,
      rawText: textOnly(lineHtml),
    };
  }

  return null;
}

function rowsFromParagraph(paragraph: string | undefined): PublicEntryRow[] {
  if (!paragraph) return [];
  return splitHtmlLines(paragraph)
    .map(parseRow)
    .filter((row): row is PublicEntryRow => row !== null);
}

/**
 * Parse the public SpazioTennis Challenger-week article shape.
 *
 * Crucially, this preserves source row order and explicit OUT / IN / <del>
 * markers. It never re-sorts by ranking, because the published queue order is
 * the historical fact we care about.
 */
export function parseSpazioChallengerWeekHtml(html: string): PublicEntryTournament[] {
  const tournaments: PublicEntryTournament[] = [];
  const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  const matches = [...html.matchAll(heading)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const slug = slugFromHeading(match[1]);
    if (!slug || match.index === undefined) continue;

    const blockStart = match.index + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? html.length;
    const block = html.slice(blockStart, blockEnd);
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((item) => item[1]);

    const main = rowsFromParagraph(paragraphs[0]);
    const alternateParagraph = paragraphs.find((paragraph) => /alternates?/i.test(textOnly(paragraph)));
    const alternates = rowsFromParagraph(alternateParagraph);

    if (main.length === 0 && alternates.length === 0) continue;
    tournaments.push({
      slug,
      sourceHeading: textOnly(match[1]),
      main,
      alternates,
    });
  }

  return tournaments;
}

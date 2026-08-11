export type CentralEntryPlayer = {
  rank: number | null;
  name: string;
  country: string | null;
};

export type CentralEntryTournament = {
  sourceName: string;
  cityKey: string;
  level: number | null;
  surface: string | null;
  main: CentralEntryPlayer[];
  wildCards: CentralEntryPlayer[];
  qualifying: CentralEntryPlayer[];
  qualifyingNextIn: CentralEntryPlayer[];
};

export type CentralEntryWeekBlock = {
  renderIndex: number | null;
  tournaments: CentralEntryTournament[];
  raw: string;
};

export type ParsedCentralEntryPage = {
  sourceUpdatedText: string | null;
  weeks: CentralEntryWeekBlock[];
};

function extractBalanced(
  source: string,
  start: number,
  open: string,
  close: string
): { text: string; end: number } | null {
  if (source[start] !== open) return null;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function decodeJsDoubleQuoted(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function parsePlayerRows(rawArray: string): CentralEntryPlayer[] {
  let rows: unknown;
  try {
    rows = JSON.parse(rawArray);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row): CentralEntryPlayer[] => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const rawRank = row[0];
    const name = typeof row[1] === 'string' ? row[1].trim() : '';
    if (!name) return [];

    const rank =
      typeof rawRank === 'number' && Number.isFinite(rawRank)
        ? rawRank
        : typeof rawRank === 'string' && /^\d+$/.test(rawRank.trim())
          ? Number(rawRank)
          : null;
    const country = typeof row[2] === 'string' && row[2].trim() ? row[2].trim() : null;
    return [{ rank, name, country }];
  });
}

function arrayField(objectText: string, key: string): CentralEntryPlayer[] {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*\\[`);
  const match = pattern.exec(objectText);
  if (!match) return [];
  const start = objectText.indexOf('[', match.index);
  const balanced = extractBalanced(objectText, start, '[', ']');
  return balanced ? parsePlayerRows(balanced.text) : [];
}

function cityKeyFromName(sourceName: string): string {
  return sourceName.replace(/\s*\(CH\s+\d+\)[\s\S]*$/i, '').trim();
}

function parseTournamentObject(objectText: string): CentralEntryTournament | null {
  const nameMatch = objectText.match(/\bname\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!nameMatch) return null;
  const sourceName = decodeJsDoubleQuoted(nameMatch[1]);
  if (!/\(CH\s+\d+\)/i.test(sourceName)) return null;

  const levelMatch = sourceName.match(/\(CH\s+(\d+)\)/i);
  const surfaceMatch = sourceName.match(/-\s*([^\-]+court)\s*$/i);

  return {
    sourceName,
    cityKey: cityKeyFromName(sourceName),
    level: levelMatch ? Number(levelMatch[1]) : null,
    surface: surfaceMatch ? surfaceMatch[1].trim() : null,
    main: arrayField(objectText, 'main'),
    wildCards: arrayField(objectText, 'wc'),
    qualifying: arrayField(objectText, 'qual'),
    qualifyingNextIn: arrayField(objectText, 'qnext'),
  };
}

function parseTournaments(block: string): CentralEntryTournament[] {
  const out: CentralEntryTournament[] = [];
  const seenStarts = new Set<number>();
  const namePattern = /\bname\s*:\s*"/g;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(block)) !== null) {
    const objectStart = block.lastIndexOf('{', match.index);
    if (objectStart < 0 || seenStarts.has(objectStart)) continue;
    const balanced = extractBalanced(block, objectStart, '{', '}');
    if (!balanced) continue;
    seenStarts.add(objectStart);
    const tournament = parseTournamentObject(balanced.text);
    if (tournament) out.push(tournament);
    namePattern.lastIndex = Math.max(namePattern.lastIndex, balanced.end);
  }
  return out;
}

export function normalizeCentralTournamentKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseCentralAtpEntryPage(html: string): ParsedCentralEntryPage {
  const sourceUpdated = html.match(/(?:Data\s+updated|Updated)\s+([^<\n]{1,100}?)(?:ticktocktennis\.com|<)/i);
  const weeks: CentralEntryWeekBlock[] = [];
  const assignment = /atpData\.week1\s*=\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = assignment.exec(html)) !== null) {
    const start = html.indexOf('{', match.index);
    const balanced = extractBalanced(html, start, '{', '}');
    if (!balanced) continue;
    const tail = html.slice(balanced.end, balanced.end + 180);
    const renderMatch = tail.match(/renderWeek\s*\(\s*atpData\.week1\s*,\s*(\d+)\s*\)/);
    weeks.push({
      renderIndex: renderMatch ? Number(renderMatch[1]) : null,
      tournaments: parseTournaments(balanced.text),
      raw: balanced.text,
    });
    assignment.lastIndex = balanced.end;
  }

  return {
    sourceUpdatedText: sourceUpdated?.[1]?.trim() ?? null,
    weeks,
  };
}

export function selectCentralWeekForCities(
  parsed: ParsedCentralEntryPage,
  cities: string[]
): { week: CentralEntryWeekBlock | null; matchedCities: string[] } {
  const targets = cities.map((city) => ({ city, key: normalizeCentralTournamentKey(city) }));
  let best: CentralEntryWeekBlock | null = null;
  let bestMatched: string[] = [];

  for (const week of parsed.weeks) {
    const tournamentKeys = week.tournaments.map((t) => normalizeCentralTournamentKey(t.cityKey));
    const matched = targets
      .filter(({ key }) => tournamentKeys.some((candidate) => candidate === key || candidate.includes(key) || key.includes(candidate)))
      .map(({ city }) => city);
    if (matched.length > bestMatched.length) {
      best = week;
      bestMatched = matched;
    }
  }

  return { week: best, matchedCities: bestMatched };
}

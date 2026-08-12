export type ProTennisQualifyingWithdrawal = {
  playerName: string;
  reason: string | null;
  rawText: string;
};

export type ProTennisQualifyingSheet = {
  placeholder: boolean;
  lastDirectAcceptanceName: string | null;
  lastDirectAcceptanceRank: number | null;
  releasedAtText: string | null;
  alternatesUsed: string[];
  withdrawals: ProTennisQualifyingWithdrawal[];
};

function lines(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function findSection(source: string[], start: RegExp, end: RegExp): string[] {
  const startIndex = source.findIndex((line) => start.test(line));
  if (startIndex < 0) return [];
  const out: string[] = [];
  for (let i = startIndex + 1; i < source.length; i += 1) {
    if (end.test(source[i])) break;
    out.push(source[i]);
  }
  return out;
}

function cleanAltName(line: string): string | null {
  const cleaned = line
    .replace(/\s*\((?:Alt|ALTs?)\)\s*$/i, '')
    .replace(/^\d+\s+/, '')
    .trim();
  if (!cleaned || /^(player|rank)$/i.test(cleaned)) return null;
  return cleaned;
}

function parseWithdrawal(line: string): ProTennisQualifyingWithdrawal | null {
  if (!line || /^(player|rank)$/i.test(line)) return null;
  const match = line.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (match) {
    return {
      playerName: match[1].trim(),
      reason: match[2].trim(),
      rawText: line,
    };
  }
  return { playerName: line.trim(), reason: null, rawText: line };
}

export function parseProTennisQualifyingSheetText(text: string): ProTennisQualifyingSheet {
  const source = lines(text);
  const placeholder = source.some((line) => /Tournament Information Not Yet Available/i.test(line));

  let lastDirectAcceptanceName: string | null = null;
  let lastDirectAcceptanceRank: number | null = null;
  const ldaIndex = source.findIndex((line) => /^Last Direct Acceptance$/i.test(line));
  if (ldaIndex >= 0) {
    for (let i = ldaIndex + 1; i < Math.min(source.length, ldaIndex + 5); i += 1) {
      if (/^(ATP Supervisor|Released|Seeded Players|Alternates|Withdrawals)/i.test(source[i])) break;
      const match = source[i].match(/^(.+?)\s*-\s*P?(\d{1,5})\b/i);
      if (match) {
        lastDirectAcceptanceName = match[1].trim() || null;
        lastDirectAcceptanceRank = Number(match[2]);
        break;
      }
    }
  }

  let releasedAtText: string | null = null;
  const releasedIndex = source.findIndex((line) => /^Released$/i.test(line));
  if (releasedIndex >= 0) {
    const candidate = source[releasedIndex + 1];
    if (candidate && /\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(candidate)) releasedAtText = candidate;
  }

  const alternatesUsed = findSection(
    source,
    /^Alternates(?:\/Lucky Losers)?$/i,
    /^(Withdrawals|Retirements(?:\/W\.O\.)?|Released|ATP Supervisor)$/i
  )
    .map(cleanAltName)
    .filter((name): name is string => Boolean(name));

  const withdrawals = findSection(
    source,
    /^Withdrawals$/i,
    /^(Retirements(?:\/W\.O\.)?|Released|Alternates(?:\/Lucky Losers)?|ATP Supervisor)$/i
  )
    .map(parseWithdrawal)
    .filter((row): row is ProTennisQualifyingWithdrawal => Boolean(row));

  return {
    placeholder,
    lastDirectAcceptanceName,
    lastDirectAcceptanceRank,
    releasedAtText,
    alternatesUsed,
    withdrawals,
  };
}

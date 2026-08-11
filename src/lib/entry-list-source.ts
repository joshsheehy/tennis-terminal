// Parser for the centralized public entry-list page.
//
// WHY THIS MATTERS MORE THAN ANOTHER PDF
//
// Every entry-list source registered so far has been one tournament's own PDF,
// which means source discovery is a per-tournament problem and coverage grows
// one hand-registered URL at a time. This page carries the ordered acceptance
// list for EVERY tournament across several upcoming weeks in a single HTML
// document, so one fetch covers the whole calendar.
//
// It also changes what can be measured. Field strength today is inferred from a
// single number — the last direct acceptance — which is a boundary, not a
// field. With the ordered list we hold the rank of every player actually
// entered, so strength can be measured from the distribution instead of the
// edge, and a specific claim like "Slam qualifying week pulls the 100-240 band
// out of Challengers" becomes directly checkable rather than inferred.
//
// The data sits in an inline script as a sequence of assignments to one scratch
// variable, each preceded by a "// WEEK n - Mon DD" comment and followed by a
// render call. The comment is the only reliable week marker: the variable name
// is reused for every week, so anything keyed off it collapses to one week.

export type EntryStatusFlag = 'PR' | 'NG' | 'JR' | 'CA' | 'CO' | string;

export type EntryPlayer = {
  /** Null for unranked players, who appear with an empty rank field. */
  rank: number | null;
  name: string;
  country: string;
  /** Trailing markers: PR protected ranking, NG next gen, JR junior, etc. */
  flags: EntryStatusFlag[];
};

export type EntryListTournament = {
  /** Raw label, e.g. "Cancun (CH 125) - Hardcourt". */
  rawName: string;
  /** Just the place, e.g. "Cancun". */
  name: string;
  /** Normalised level, e.g. "Challenger 125", "ATP 250", "ITF M25". */
  level: string | null;
  /** Tier bucket the source filed it under, kept for diagnosis. */
  bucket: string | null;
  surface: string | null;
  main: EntryPlayer[];
  wildCards: EntryPlayer[];
  qualifying: EntryPlayer[];
  /** Next in line for qualifying — the alternates queue. */
  qualifyingNext: EntryPlayer[];
};

export type EntryListWeek = {
  /** Week number as labelled in the source. */
  sourceWeek: number;
  /** Date label as printed, e.g. "Aug 17". */
  dateLabel: string;
  tournaments: EntryListTournament[];
};

/** Level implied by the tier bucket a tournament sits in.
 *
 * Only a fallback. The Challenger bucket is useless for this — every event from
 * CH 50 to CH 125 is filed under one "atp125" key — but the tour buckets are
 * accurate, and ATP tour events are exactly the ones whose labels carry no
 * level marker ("Winston-Salem - Hardcourt"). */
export function levelFromBucket(bucket: string | null): string | null {
  switch (bucket) {
    case 'gs':
      return 'Grand Slam';
    case 'atp1000':
      return 'ATP 1000';
    case 'atp500':
      return 'ATP 500';
    case 'atp250':
      return 'ATP 250';
    default:
      return null;
  }
}

/** Level embedded in the tournament label, where there is one. */
export function parseLevelFromName(rawName: string): string | null {
  const ch = rawName.match(/\(CH\s*(\d+)\)/i);
  if (ch) return `Challenger ${ch[1]}`;
  const atp = rawName.match(/\(ATP\s*(\d+)\)/i);
  if (atp) return `ATP ${atp[1]}`;
  const itf = rawName.match(/^(M\d+)\s/i);
  if (itf) return `ITF ${itf[1].toUpperCase()}`;
  if (/US Open|Australian Open|Roland Garros|Wimbledon/i.test(rawName)) {
    return /qualifying/i.test(rawName) ? 'Grand Slam Qualifying' : 'Grand Slam';
  }
  return null;
}

export function parseSurfaceFromName(rawName: string): string | null {
  const m = rawName.match(/-\s*(Hardcourt|Claycourt|Grasscourt|Carpet)/i);
  if (!m) return null;
  const s = m[1].toLowerCase();
  if (s.startsWith('clay')) return 'Clay';
  if (s.startsWith('grass')) return 'Grass';
  if (s.startsWith('carpet')) return 'Carpet';
  return 'Hard';
}

/** Strip the level and surface decoration to leave the place name. */
export function parsePlaceFromName(rawName: string): string {
  return rawName
    .replace(/\((?:CH|ATP)\s*\d+\)/i, '')
    .replace(/-\s*(Hardcourt|Claycourt|Grasscourt|Carpet)\s*$/i, '')
    .replace(/^M\d+\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** One player tuple: [rank, name, country, ...flags]. Rank is "" when unranked. */
function toPlayer(tuple: unknown): EntryPlayer | null {
  if (!Array.isArray(tuple) || tuple.length < 2) return null;
  const rawRank = tuple[0];
  const rank =
    typeof rawRank === 'number' && Number.isFinite(rawRank) && rawRank > 0 ? rawRank : null;
  const name = typeof tuple[1] === 'string' ? tuple[1] : '';
  if (!name) return null;
  return {
    rank,
    name,
    country: typeof tuple[2] === 'string' ? tuple[2] : '',
    flags: tuple.slice(3).filter((f): f is string => typeof f === 'string' && f.length > 0),
  };
}

/** Read a bracketed array starting at `open`, respecting nesting and strings. */
function readArray(src: string, open: number): { text: string; end: number } | null {
  if (src[open] !== '[') return null;
  let depth = 0;
  let inString = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return { text: src.slice(open, i + 1), end: i + 1 };
    }
  }
  return null;
}

function playersFrom(src: string, key: string, from: number, limit: number): EntryPlayer[] {
  const marker = new RegExp(`\\b${key}\\s*:\\s*\\[`);
  const slice = src.slice(from, limit);
  const m = marker.exec(slice);
  if (!m) return [];
  const arr = readArray(slice, m.index + m[0].length - 1);
  if (!arr) return [];
  try {
    const parsed: unknown = JSON.parse(arr.text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(toPlayer).filter((p): p is EntryPlayer => p != null);
  } catch {
    return []; // a malformed block must not take the whole week down
  }
}

/**
 * Parse every week and tournament out of the page.
 *
 * Tournaments are located by their `name:` key rather than by walking the
 * object structure, because the payload is JavaScript rather than JSON —
 * unquoted keys, and tier buckets whose names cannot be trusted.
 */
export function parseEntryListPage(html: string): EntryListWeek[] {
  const weekMarks = [...html.matchAll(/\/\/\s*WEEK\s+(\d+)\s*-\s*([A-Za-z]{3}\s+\d+)/g)];
  if (weekMarks.length === 0) return [];

  const weeks: EntryListWeek[] = [];

  for (let w = 0; w < weekMarks.length; w++) {
    const start = weekMarks[w].index! + weekMarks[w][0].length;
    const end = w + 1 < weekMarks.length ? weekMarks[w + 1].index! : html.length;
    const section = html.slice(start, end);

    const nameMatches = [...section.matchAll(/name:\s*"([^"]+)"/g)];
    const bucketMarks = [...section.matchAll(/"(gs|atp\d+|itf)"\s*:\s*\[/g)];
    const bucketAt = (pos: number): string | null => {
      let found: string | null = null;
      for (const b of bucketMarks) {
        if (b.index! > pos) break;
        found = b[1];
      }
      return found;
    };
    const tournaments: EntryListTournament[] = [];

    for (let t = 0; t < nameMatches.length; t++) {
      const rawName = nameMatches[t][1];
      const from = nameMatches[t].index!;
      const to = t + 1 < nameMatches.length ? nameMatches[t + 1].index! : section.length;
      const bucket = bucketAt(from);
      tournaments.push({
        rawName,
        name: parsePlaceFromName(rawName),
        bucket,
        // The label wins where it carries a marker; the bucket only fills in
        // for ATP tour events, whose labels carry none.
        level: parseLevelFromName(rawName) ?? levelFromBucket(bucket),
        surface: parseSurfaceFromName(rawName),
        main: playersFrom(section, 'main', from, to),
        wildCards: playersFrom(section, 'wc', from, to),
        qualifying: playersFrom(section, 'qual', from, to),
        qualifyingNext: playersFrom(section, 'qnext', from, to),
      });
    }

    weeks.push({
      sourceWeek: Number(weekMarks[w][1]),
      dateLabel: weekMarks[w][2].replace(/\s+/g, ' ').trim(),
      tournaments,
    });
  }

  return weeks;
}

/**
 * The cut implied by an entry list: the worst-ranked direct acceptance.
 *
 * Wildcards are excluded because they do not set a cut, and unranked players are
 * excluded because they cannot be the boundary in ranking terms. This is the
 * same quantity as last_direct_acceptance_rank, derived from the list rather
 * than read off a PDF footer, which makes the two cross-checkable.
 */
export function impliedCut(players: EntryPlayer[]): number | null {
  const ranks = players
    .filter((p) => !p.flags.includes('WC'))
    .map((p) => p.rank)
    .filter((r): r is number => r != null);
  return ranks.length ? Math.max(...ranks) : null;
}

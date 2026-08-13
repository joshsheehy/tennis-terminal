// The ATP tournament detail sheet — the "ds.pdf" every event posts at
// https://www.protennislive.com/posting/{year}/{atpCode}/ds.pdf
//
// Its "DRAWS, CUTOFFS & SCHEDULE" table is the authoritative statement of how
// each draw is built, and it is public. One row per draw:
//
//   QUALIFYING          Sun 16 Aug   -          24  20/18  4  -  -  0/2  538
//   MAIN DRAW SINGLES   Mon 17 Aug   Sat 22 Aug 32  23/18  3  6  0/2  0/3  548
//   MAIN DRAW DOUBLES   Mon 17 Aug   Sat 22 Aug 16  14     2  -  -    -    396
//
// under the headings: Size | DA | WC | Q | SE | NG | 2025 Cut Offs.
//
// This settles what no other source would tell us. Draw size is NOT a property
// of the level: Cancun and Prague are both above Challenger 50 yet run a 28 and
// a 32 respectively, and the qualifying draws are 16 and 24. The parts add up —
// Cancun 21 DA + 3 WC + 4 Q = 28, Prague 23 + 3 + 6 = 32 — so the table also
// checks itself.
//
// Several cells are printed as "a/b". Only the first number is treated as the
// count; the raw cell is kept verbatim rather than guessing at the second,
// which is not documented on the sheet.

export type DetailSheetDrawKind = 'qualifying' | 'main_singles' | 'main_doubles';

export type DetailSheetDraw = {
  draw: DetailSheetDrawKind;
  /** Total places in the draw. */
  size: number | null;
  directAcceptances: number | null;
  wildCards: number | null;
  qualifiers: number | null;
  specialExempts: number | null;
  /** Places held for special exempts, whether or not any are taken yet. */
  specialExemptsHeld: number | null;
  nextGen: number | null;
  nextGenHeld: number | null;
  /** The "2025 Cut Offs" column: last year's cut for this draw. */
  priorCutoff: number | null;
  /** The cells as printed, because some are "a/b" and the sheet never says why. */
  raw: string;
};

export type DetailSheet = {
  atpCode: string | null;
  eventName: string | null;
  level: string | null;
  draws: DetailSheetDraw[];
};

const ROW_LABELS: Array<[RegExp, DetailSheetDrawKind]> = [
  [/^MAIN\s+DRAW\s+SINGLES\b/i, 'main_singles'],
  [/^MAIN\s+DRAW\s+DOUBLES\b/i, 'main_doubles'],
  [/^QUALIFYING\b/i, 'qualifying'],
];

/**
 * A cell is a count, a dash, or an unavailable marker.
 *
 * "23/18" yields 23 and "0/2" yields 0 — the leading number is the one the
 * other columns add up with. "-", "N/A" and Excel's "#N/A" all mean absent.
 */
export function parseSheetCell(cell: string): number | null {
  return parseSheetPair(cell).value;
}

/**
 * Both halves of a cell printed as "a/b".
 *
 * The second number matters. SE reads "0/2" and NG reads "0/3": none taken so
 * far, that many places held. Those held places are why an acceptance list can
 * name 21 players against a stated 23 DA — the draw is not short, it is holding
 * two places back. Dropping the second number made that gap look like an error.
 */
export function parseSheetPair(cell: string): { value: number | null; of: number | null } {
  const text = cell.trim();
  if (!text || text === '-' || /^#?N\/A$/i.test(text)) return { value: null, of: null };
  const pair = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (pair) return { value: Number(pair[1]), of: Number(pair[2]) };
  const single = text.match(/^(\d+)/);
  return { value: single ? Number(single[1]) : null, of: null };
}

function splitCells(line: string): string[] {
  return line
    .split(/\t|\s{2,}|\s\|\s/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/**
 * Parse the draws table out of detail-sheet text.
 *
 * The seven data columns are taken from the END of the row. The date columns
 * before them vary — qualifying prints a dash where the others print a final
 * date, and some sheets wrap the venue text into the same line — so counting
 * backwards from a fixed-width tail is stable where counting forwards is not.
 */
export function parseDetailSheetText(text: string): DetailSheet {
  const lines = text.split('\n');

  let atpCode: string | null = null;
  let eventName: string | null = null;
  let level: string | null = null;

  for (const line of lines.slice(0, 40)) {
    const code = line.match(/\((\d{3,5})\)\s*$/);
    if (code && !atpCode) atpCode = code[1];
    const lvl = line.match(/\b(ATP\s+Challenger\s+\d{2,3}|ATP\s+\d{3})\b/i);
    if (lvl && !level) level = lvl[1].replace(/\s+/g, ' ');
    if (!eventName && /^[A-Z][A-Z .'\-&]{4,}$/.test(line.trim()) && !/\(/.test(line)) {
      eventName = line.trim();
    }
  }

  const draws: DetailSheetDraw[] = [];
  const seen = new Set<DetailSheetDrawKind>();

  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length < 8) continue;
    const kind = ROW_LABELS.find(([pattern]) => pattern.test(cells[0]))?.[1];
    if (!kind || seen.has(kind)) continue;

    const tail = cells.slice(-7);
    const [size, da, wc, q, cut] = [tail[0], tail[1], tail[2], tail[3], tail[6]].map(parseSheetCell);
    const se = parseSheetPair(tail[4]);
    const ng = parseSheetPair(tail[5]);
    // A draws row always states a size. Anything without one is prose that
    // happened to start with the same words.
    if (size == null) continue;

    seen.add(kind);
    draws.push({
      draw: kind,
      size,
      directAcceptances: da,
      wildCards: wc,
      qualifiers: q,
      specialExempts: se.value,
      specialExemptsHeld: se.of,
      nextGen: ng.value,
      nextGenHeld: ng.of,
      priorCutoff: cut,
      raw: tail.join(' | '),
    });
  }

  return { atpCode, eventName, level, draws };
}

/**
 * True when the stated parts account for the stated size.
 *
 * Worth checking rather than trusting: if a column ever moves, the arithmetic
 * breaks loudly instead of the page quietly showing a wrong breakdown.
 */
export function drawAddsUp(draw: DetailSheetDraw): boolean {
  if (draw.size == null || draw.directAcceptances == null) return false;
  // A dash means the column does not apply to this draw — no qualifiers feed a
  // qualifying draw — so it contributes nothing rather than voiding the check.
  const parts = [draw.directAcceptances, draw.wildCards, draw.qualifiers];
  return parts.reduce((sum: number, part) => sum + (part ?? 0), 0) === draw.size;
}

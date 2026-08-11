// Real singles draw sizes from JeffSackmann's match CSVs.
//
// tournament_editions has carried singles_draw_size / qualifying_draw_size /
// doubles_draw_size since the first schema, but no importer ever wrote them, so
// every acceptance-slot count in src/lib/depth.ts falls back to a per-level
// default. Those defaults flatten variation that is real and large: an ATP 1000
// is a 56 draw at most stops but 96 at Indian Wells and Miami, and Challenger
// main draws are 32 at some events and 48 at others regardless of level.
//
// Each match row carries the size of the draw the match belongs to, so the
// round column separates the two draws of one tournament: qualifying rounds
// (Q1/Q2/Q3) give the qualifying draw, everything else gives the main draw.
//
// Doubles is NOT covered — tennis_atp's doubles files do not span the tour and
// Challenger calendar, so doubles slots stay on their per-level default and
// keep reporting source 'default'.

/** Minimal CSV field splitter: handles quoted fields containing commas, which
 * appear in tourney_name. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export type TourneyDrawSizes = {
  code: number;
  name: string;
  startDate: string;
  mainDrawSize: number | null;
  qualifyingDrawSize: number | null;
};

const QUALIFYING_ROUND = /^Q\d+$/i;

/**
 * Extract per-tournament draw sizes from a Sackmann matches CSV.
 *
 * `levels` filters tourney_level: 'A'/'M' for the tour file, 'C' for the
 * qual_chall file. Draw sizes are taken as the MAXIMUM seen per draw, because a
 * handful of rows in these files carry a stale or partial size and the real
 * draw can never be smaller than the largest one observed.
 */
export function parseSackmannDrawSizes(
  csvText: string,
  levels: readonly string[]
): TourneyDrawSizes[] {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0].replace(/\r/g, ''));
  const col = (n: string) => headers.indexOf(n);
  const idIdx = col('tourney_id');
  const nameIdx = col('tourney_name');
  const dateIdx = col('tourney_date');
  const levelIdx = col('tourney_level');
  const sizeIdx = col('draw_size');
  const roundIdx = col('round');
  if ([idIdx, nameIdx, dateIdx, levelIdx, sizeIdx, roundIdx].some((i) => i === -1)) {
    throw new Error(`Missing expected columns. Headers: ${headers.join(', ')}`);
  }

  const allowed = new Set(levels);
  const byTourney = new Map<string, TourneyDrawSizes>();

  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r/g, '').trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (!allowed.has(cols[levelIdx] ?? '')) continue;

    const tourneyId = cols[idIdx] ?? '';
    const codePart = tourneyId.split('-')[1];
    if (!codePart) continue;
    const code = parseInt(codePart, 10);
    if (!Number.isFinite(code) || code <= 0) continue;

    const rawDate = cols[dateIdx] ?? '';
    if (!/^\d{8}$/.test(rawDate)) continue;

    const size = parseInt(cols[sizeIdx] ?? '', 10);
    if (!Number.isFinite(size) || size <= 0) continue;

    let entry = byTourney.get(tourneyId);
    if (!entry) {
      entry = {
        code,
        name: cols[nameIdx] ?? '',
        startDate: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
        mainDrawSize: null,
        qualifyingDrawSize: null,
      };
      byTourney.set(tourneyId, entry);
    }

    if (QUALIFYING_ROUND.test(cols[roundIdx] ?? '')) {
      entry.qualifyingDrawSize = Math.max(entry.qualifyingDrawSize ?? 0, size);
    } else {
      entry.mainDrawSize = Math.max(entry.mainDrawSize ?? 0, size);
    }
  }

  return [...byTourney.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

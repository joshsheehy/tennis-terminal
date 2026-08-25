// Deciding whether two tournament records are the same event.
//
// Sharing a city is nowhere near enough. Paris holds Roland Garros and the
// Rolex Paris Masters; London holds Wimbledon and Queen's; Oeiras runs four
// separate Challengers. A city-only check calls all of those duplicates, and
// acting on it would destroy real tournaments and their cut history.
//
// What actually distinguishes a split record from a neighbouring event is WHEN
// it is played. One event cannot be in two places in the calendar:
//
//   - Two records with editions in the same week of the same year are one event
//     entered twice. That is the Mouilleron-le-Captif case.
//   - Two records whose years do not overlap but which occupy the same week of
//     the calendar are one event renamed. That is the Metz case, where Moselle
//     Open holds 2022-2025 and two other records split 2026.
//
// Distinct events in a shared city sit in different weeks, so both tests leave
// them alone. The level has to match too: a Challenger and a Masters in one city
// are never the same event however the weeks fall.

export type SplitEdition = { year: number; week: number; level: string };

export type SplitRecord = {
  tournamentId: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  editions: SplitEdition[];
  cutoffCount: number;
};

export type SplitReason = 'same-week-same-year' | 'renamed-same-week';

// A rename can move the event a week as the calendar shifts, so the rename test
// allows one week either side. The same-year test does not: Challenger series
// run "City 1" and "City 2" in consecutive weeks, and treating adjacent weeks as
// one event merged Oeiras, Tenerife, Abidjan, Brisbane and six more pairs of
// genuinely separate tournaments.
const RENAME_WEEK_TOLERANCE = 1;

/**
 * "Oeiras 1" and "Oeiras 2" are two tournaments, and the numbers say so.
 *
 * The strongest single signal in the data: a city running a series numbers its
 * events, and two different numbers are never one event however the weeks fall.
 */
function differentNumberedEvents(a: SplitRecord, b: SplitRecord): boolean {
  const seriesNumber = (record: SplitRecord) => {
    const match = record.name.trim().match(/(?:^|[\s(])(\d{1,2})\)?$/);
    return match ? match[1] : null;
  };
  const left = seriesNumber(a);
  const right = seriesNumber(b);
  return left !== null && right !== null && left !== right;
}

const levelsOverlap = (a: SplitRecord, b: SplitRecord) => {
  const levels = new Set(a.editions.map((e) => e.level));
  return b.editions.some((e) => levels.has(e.level));
};

function sameWeekSameYear(a: SplitRecord, b: SplitRecord): boolean {
  return a.editions.some((left) =>
    b.editions.some((right) => left.year === right.year && left.week === right.week)
  );
}

function renamedSameWeek(a: SplitRecord, b: SplitRecord): boolean {
  const yearsA = new Set(a.editions.map((e) => e.year));
  const overlapping = b.editions.some((e) => yearsA.has(e.year));
  if (overlapping) return false;
  return a.editions.some((left) =>
    b.editions.some((right) => Math.abs(left.week - right.week) <= RENAME_WEEK_TOLERANCE)
  );
}

/**
 * Why these two records look like one event, or null if they do not.
 *
 * Both tests require the levels to match, so a Challenger is never merged into
 * the Masters that shares its city.
 */
export function splitReason(a: SplitRecord, b: SplitRecord): SplitReason | null {
  if (a.editions.length === 0 || b.editions.length === 0) return null;
  if (!levelsOverlap(a, b)) return null;
  if (differentNumberedEvents(a, b)) return null;
  if (sameWeekSameYear(a, b)) return 'same-week-same-year';
  if (renamedSameWeek(a, b)) return 'renamed-same-week';
  return null;
}

/**
 * Group records that are each linked to at least one other in the group.
 *
 * Transitive on purpose: Mouilleron-le-Captif's three records link through the
 * one that carries every year, and all three belong together.
 */
export function clusterSplits(records: SplitRecord[]): Array<{
  records: SplitRecord[];
  reasons: SplitReason[];
}> {
  const clusters: Array<{ records: SplitRecord[]; reasons: SplitReason[] }> = [];
  const placed = new Set<string>();

  for (const record of records) {
    if (placed.has(record.tournamentId)) continue;
    const group = [record];
    const reasons = new Set<SplitReason>();
    placed.add(record.tournamentId);

    // Breadth-first: a record joins if it links to anything already in.
    for (let i = 0; i < group.length; i += 1) {
      for (const candidate of records) {
        if (placed.has(candidate.tournamentId)) continue;
        const reason = splitReason(group[i], candidate);
        if (!reason) continue;
        reasons.add(reason);
        group.push(candidate);
        placed.add(candidate.tournamentId);
      }
    }

    if (group.length > 1) clusters.push({ records: group, reasons: [...reasons] });
  }

  return clusters;
}

/**
 * The record to merge the others into: the one carrying the most history.
 *
 * Cut history is the asset, so the record holding the most of it survives and
 * the fewest links have to be rewritten. Ties go to the record covering more
 * years, then to the longer slug, which is the one carrying the event's real
 * name rather than a bare city.
 */
export function suggestCanonical(records: SplitRecord[]): SplitRecord {
  return [...records].sort(
    (a, b) =>
      b.cutoffCount - a.cutoffCount ||
      b.editions.length - a.editions.length ||
      b.slug.length - a.slug.length
  )[0];
}

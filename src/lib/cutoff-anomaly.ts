// Sanity-check thresholds for parsed cutoff ranks. When a PDF's
// LAST DIRECT ACCEPTANCE footer is blank but the label exists, the bottom-left
// box parser can latch onto a nearby seed bracket / draw-position number and
// return a single-digit "cut" — a value that's structurally impossible for
// real ATP/Challenger events. These guards turn an obviously-impossible parse
// into a flagged null so the importer doesn't clobber existing data with
// garbage, and so the schedule shows "Not on record" instead of "12" until a
// human can set the real cut via /api/set-cut.
//
// Thresholds are intentionally loose. Real cuts can be surprisingly low —
// Tokyo ATP 500 main draw cuts routinely live in the 30s, and ATP 1000 cuts
// have been in the high 20s in weak fields — so we only reject values that
// are below the structural minimum for the event's draw size.

export function minPlausibleRank(
  level: string,
  event: 'singles' | 'doubles',
  draw: 'main' | 'qualifying'
): number {
  const lower = level.toLowerCase();
  if (draw === 'qualifying') return 30;
  if (lower.includes('grand slam')) return event === 'singles' ? 30 : 20;
  if (lower.includes('1000')) return event === 'singles' ? 25 : 20;
  if (lower.includes('500')) return event === 'singles' ? 15 : 20;
  if (lower.includes('250')) return event === 'singles' ? 10 : 20;
  if (lower.includes('challenger')) return 50;
  return 5;
}

export type RankAnomaly = {
  rejectedRank: number;
  minimumExpected: number;
  level: string;
  event: 'singles' | 'doubles';
  draw: 'main' | 'qualifying';
  reason: string;
};

export function checkRankAnomaly(
  rank: number | null,
  level: string | null | undefined,
  event: 'singles' | 'doubles',
  draw: 'main' | 'qualifying'
): RankAnomaly | null {
  if (rank === null) return null;
  if (!level) return null;
  const min = minPlausibleRank(level, event, draw);
  if (rank >= min) return null;
  return {
    rejectedRank: rank,
    minimumExpected: min,
    level,
    event,
    draw,
    reason: `Parsed rank ${rank} below minimum plausible ${min} for ${level} ${event} ${draw} — treating as parser misread.`,
  };
}

// Tag we splice into source_notes so the row visibly carries the rejection
// reason in the DB. The string survives unchanged through ON CONFLICT updates
// and is greppable for diagnostics.
export const ANOMALY_TAG = 'ANOMALY_REJECTED';

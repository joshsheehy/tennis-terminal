// Field strength on a 0-100 scale, and how it moved against the year before.
//
// The measurement is the cut itself: the weakest player who got in directly. A
// Challenger 100 that cut at 150 had a far stronger field than one that cut at
// 400. No model, no projection — these are the numbers already stored in
// cutoff_snapshots.
//
// The problem a raw cut has is that it is not a scale. #150 is a strong field
// at a Challenger 100 and a weak one at an ATP 500, so cuts cannot be compared
// across levels, and nobody can read one at a glance. So each cut is scored
// against every other cut ever recorded AT ITS OWN LEVEL: the score is the
// share of that cohort the field beat.
//
//   100 = the strongest field on record for that level
//     0 = the weakest
//    50 = a completely typical edition of that event's level
//
// That makes an ATP 250 and a Challenger 75 directly comparable, and it makes
// year-over-year movement readable as a single number.
//
// ITF is deliberately out of scope: cuts are not collected for those events, so
// there is nothing to score. Challenger, ATP and Grand Slam only.

import { levelGroup } from './swings';

/** Levels we score. ITF has no cut data, so it is excluded outright. */
export function isScorableLevel(level: string): boolean {
  const g = levelGroup(level);
  return g === 'atp' || g === 'challenger';
}

/** Cohorts below this size make percentiles too coarse to show confidently. */
export const MIN_COHORT = 8;

export type StrengthCohorts = Map<string, number[]>;

/**
 * Sorted cut cohorts keyed by exact level string ("Challenger 100", "ATP 500").
 *
 * Pooled across every season rather than computed per year on purpose: if the
 * whole level gets weaker one season, every event in it should score lower.
 * A per-year cohort would re-centre that away and hide the very movement this
 * is meant to show.
 */
export function buildCohorts(
  observations: Array<{ level: string; cut: number | null }>
): StrengthCohorts {
  const cohorts: StrengthCohorts = new Map();
  for (const o of observations) {
    if (o.cut == null || o.cut < 3) continue;
    if (!isScorableLevel(o.level)) continue;
    const list = cohorts.get(o.level);
    if (list) list.push(o.cut);
    else cohorts.set(o.level, [o.cut]);
  }
  for (const list of cohorts.values()) list.sort((a, b) => a - b);
  return cohorts;
}

/**
 * Score a cut against its level cohort. Lower cut = stronger field = higher
 * score, so the scale reads the intuitive way round.
 *
 * Ties are counted as half, which keeps a cohort of identical cuts at 50 rather
 * than collapsing to 0 or 100.
 */
export function strengthScore(cut: number, cohort: number[]): number | null {
  if (cohort.length < MIN_COHORT) return null;
  let below = 0;
  let equal = 0;
  for (const c of cohort) {
    if (c > cut) below++;
    else if (c === cut) equal++;
  }
  return Math.round(((below + equal / 2) / cohort.length) * 100);
}

export type StrengthBand =
  | 'much-stronger'
  | 'stronger'
  | 'similar'
  | 'weaker'
  | 'much-weaker';

// Band edges calibrated against the real distribution of year-over-year moves,
// not picked by eye. Measured on production: the middle half of events moves
// between -19 and +13 points, p10/p90 are -46/+28. An earlier cut of this used
// 5/15 and put 54% of events in a "Much" band while only 18% landed in "About
// the same", which makes the labels say nothing. At 12/30 the typical event
// reads as unchanged and "Much" stays reserved for the outer ~15%.
export const BAND_EDGE = { notable: 12, extreme: 30 } as const;

/** Movement in score points, banded for display. */
export function strengthBand(delta: number): StrengthBand {
  if (delta >= BAND_EDGE.extreme) return 'much-stronger';
  if (delta >= BAND_EDGE.notable) return 'stronger';
  if (delta <= -BAND_EDGE.extreme) return 'much-weaker';
  if (delta <= -BAND_EDGE.notable) return 'weaker';
  return 'similar';
}

// Labels are written from the PLAYER's side, not the field's. The band names
// describe the field (a "much-stronger" field), but what someone deciding where
// to enter needs to read is what that does to them: a stronger field means a
// lower cut and a harder draw, so it is tougher to get into.
export const BAND_LABEL: Record<StrengthBand, string> = {
  'much-stronger': 'Much tougher to enter',
  stronger: 'Tougher to enter',
  similar: 'About the same',
  weaker: 'Easier to enter',
  'much-weaker': 'Much easier to enter',
};

/** What happened to the field itself, for the line that explains the move. */
export const BAND_FIELD_LABEL: Record<StrengthBand, string> = {
  'much-stronger': 'much stronger field',
  stronger: 'stronger field',
  similar: 'similar field',
  weaker: 'weaker field',
  'much-weaker': 'much weaker field',
};

// Colour tracks OPPORTUNITY, not field strength. Green is the event that got
// easier to get into. An earlier version painted a stronger field green and a
// weaker one red on a good/bad reading, which told a player the opposite of
// what they needed: "much weaker" is the opening, and it was showing in red.
export const BAND_COLOR: Record<StrengthBand, string> = {
  'much-stronger': '#b3261e',
  stronger: '#c2691e',
  similar: '#8a8a8a',
  weaker: '#1a7f47',
  'much-weaker': '#0f6b3a',
};

/**
 * Plain reading of a score. The score is a percentile by construction, so it
 * translates directly and needs no hedging: a 52 beat 52% of the editions
 * recorded at that level.
 */
export function scoreMeaning(score: number, level: string): string {
  if (score >= 90) return `stronger than almost every ${level} on record`;
  if (score <= 10) return `weaker than almost every ${level} on record`;
  return `stronger than ${score}% of ${level} editions on record`;
}

/** One sentence a beginner can act on. */
export function entryMeaning(score: number): string {
  if (score >= 75) return 'a hard field to get into';
  if (score >= 55) return 'a bit harder to get into than usual';
  if (score > 45) return 'a normal field for this level';
  if (score > 25) return 'a bit easier to get into than usual';
  return 'an easy field to get into';
}

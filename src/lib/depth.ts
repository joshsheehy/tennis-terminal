// Competitive depth: how many acceptance slots at or above a given event's
// level sit within travel range of it in the same week. Pure functions only —
// the routes feed it rows and store what it returns.
//
// WHY THIS IS NOT THE SUPPLY RATIO THAT ALREADY FITTED TO ZERO
//
// src/lib/cut-prediction.ts carries `supplySignalsFor()` / `sameWeekRatio`,
// pinned to exponent 0 because it showed no residual signal on the 2022-2026
// backtest. Depth is a different construct and the null result does not
// transfer, for two reasons:
//
//   1. sameWeekRatio is level-SYMMETRIC. A Challenger 125 leaving a region and
//      a Challenger 75 leaving it move the mass term by a similar amount, but
//      their effects on a Challenger 100's cut are opposite in sign — the 125
//      was absorbing the top of the regional field, the 75 was not. Summing
//      opposite-signed effects into one scalar drives a fitted coefficient
//      toward zero whatever the true effect size is. Depth is level-RELATIVE:
//      only events at or above the target count, so the two cases separate.
//   2. A ratio is not a position. A week going from (C125 + C75) to
//      (C100 + C100) leaves total mass roughly unchanged while moving the top
//      event's competitive position substantially; the ratio reads ~1.0 and
//      reports "comparable week".
//
// DIRECTION, which is easy to get backwards and is worse than nothing if you
// do: depth counts SLOTS, not players. The pool of players in a region in a
// given week is roughly fixed. Fewer slots at-or-above you (LOW depth) means
// the same players chasing fewer places, so only stronger players get in —
// a TOUGHER cut, which is a LOWER rank number. High depth spreads the field
// out and admits weaker players — an EASIER cut, a HIGHER rank number.
// So depth and cut rank move TOGETHER: depth up => cut number up.

export type Discipline = 'singles' | 'doubles';

// --- Level hierarchy --------------------------------------------------------
// Reuses the prestige ranking that already drives swing detection rather than
// forking a second hierarchy. Its scale is:
//   Grand Slam 100 > Finals 95 > ATP 1000 90 > 500 80 > 250 70
//   > C175 60 > C125 55 > C100 50 > C80 47 > C75 45 > C50 40 > Challenger 35
//   > ITF M25 20 > M15 15 > ITF 10 > unknown 0
// Deterministic in v1: no learned attractiveness. Only the ordering is used,
// since tier_factor is a step function on >=.
export { levelRank } from './swings';
import { levelRank } from './swings';

/** Rank of Challenger 175, the top of the Challenger stack. */
export const CHALLENGER_STACK_TOP = 60;

/** True when `level` sits above the Challenger 175 line, i.e. it draws from a
 * population largely outside the Challenger pool and must be counted through
 * the absorption table rather than at face draw size. */
export function isAboveChallengerStack(level: string): boolean {
  return levelRank(level) > CHALLENGER_STACK_TOP;
}

// --- Substitutability -------------------------------------------------------

/** Distance decay. Replaces the 3,000 km hard cutoff used by the old supply
 * term, which put Morocco and Finland in the same bucket as neighbours while
 * excluding Istanbul entirely. Floor is deliberately non-zero: a long flight
 * suppresses substitution, it does not forbid it. */
export function wGeo(km: number): number {
  return Math.max(0.03, Math.exp(-km / 1200));
}

type SurfaceFamily = 'hard' | 'clay' | 'grass';

/** Carpet is folded into indoor hard — it survives only in legacy rows. */
export function surfaceFamily(surface: string): SurfaceFamily {
  const s = surface.toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  return 'hard';
}

export function isIndoorSurface(surface: string, indoor: boolean | null): boolean {
  if (indoor != null) return indoor;
  return surface.toLowerCase().includes('carpet');
}

/** Surface substitutability. Never zero: players who cannot get into their
 * preferred surface take what is available rather than not playing. */
export function wSurface(
  a: { surface: string; indoor: boolean | null },
  b: { surface: string; indoor: boolean | null }
): number {
  const fa = surfaceFamily(a.surface);
  const fb = surfaceFamily(b.surface);
  if (fa === fb) {
    return isIndoorSurface(a.surface, a.indoor) === isIndoorSurface(b.surface, b.indoor)
      ? 1.0
      : 0.85;
  }
  if (fa === 'grass' || fb === 'grass') return 0.3;
  return 0.55; // clay vs hard
}

// --- Acceptance slots -------------------------------------------------------
// da_slots is the number of places that actually set a cut, NOT main-draw size:
//   singles: md_size - wildcards - qualifier_slots
//   doubles: md_teams - wildcard_teams, counted IN TEAMS
//
// /api/import-draw-sizes writes singles_draw_size and qualifying_draw_size from
// JeffSackmann's match CSVs, so SINGLES counts are derived from the real draw
// where that has run and report source 'actual'. The values below remain the
// fallback for events the importer has not reached.
//
// DOUBLES is always a default: tennis_atp's doubles files do not span the tour
// and Challenger calendar, so doubles_draw_size stays unwritten. Wildcard
// counts are estimates in both disciplines — they are not published in any feed
// we read, and home-federation events often grant extra ones — so even an
// 'actual' draw size yields an approximate acceptance count.

export type SlotSource = 'actual' | 'default';
export type Slots = { slots: number; source: SlotSource };

type SlotDefault = { singles: number; doubles: number };

/** Keyed by the shared level rank. Challenger singles draws are 32 across every
 * level — the difference between a C50 and a C175 is prize money and points,
 * not places, and that difference is carried by the level hierarchy instead. */
const SLOT_DEFAULTS: Array<[minRank: number, slots: SlotDefault]> = [
  [100, { singles: 104, doubles: 60 }], // Slam: 128-8WC-16Q ; 64 teams-4WC
  [95, { singles: 0, doubles: 0 }], // ATP Finals: invitational, sets no cut
  [90, { singles: 43, doubles: 22 }], // ATP 1000: 56-6WC-7Q ; 24 teams-2WC
  [80, { singles: 24, doubles: 14 }], // ATP 500: 32-4WC-4Q ; 16 teams-2WC
  [70, { singles: 24, doubles: 14 }], // ATP 250
  [35, { singles: 25, doubles: 14 }], // Challenger, all levels: 32-3WC-4Q ; 16-2WC
  [10, { singles: 24, doubles: 14 }], // ITF
];

/** Places a level's main draw gives away before direct acceptances start:
 * wildcards, plus qualifier slots for singles. Still per-level estimates — the
 * counts are not published in any feed we read, and home-federation events
 * often grant extra wildcards. */
function reservedSlots(rank: number, discipline: Discipline): number {
  if (discipline === 'doubles') return rank >= 100 ? 4 : 2;
  if (rank >= 100) return 8 + 16; // Slam: wildcards + qualifiers
  if (rank >= 90) return 6 + 7;
  if (rank >= 70) return 4 + 4;
  return 3 + 4; // Challenger and below
}

/**
 * Acceptance places that actually set a cut.
 *
 * `actualDrawSize` is the real main draw from tournament_editions when an
 * importer has written it (singles only — see src/lib/draw-sizes.ts). When
 * present the count is derived from it and reported as 'actual'; otherwise it
 * falls back to the per-level default and reports 'default', so downstream
 * confidence degrades exactly where the number is a guess.
 */
export function daSlots(
  level: string,
  discipline: Discipline,
  actualDrawSize?: number | null
): Slots {
  const rank = levelRank(level);
  if (rank === 0) return { slots: 0, source: 'default' };

  if (discipline === 'singles' && actualDrawSize != null && actualDrawSize > 0) {
    const slots = actualDrawSize - reservedSlots(rank, discipline);
    // A draw smaller than its own reserved places means the size is wrong, not
    // that the event has no acceptances; fall through to the default.
    if (slots > 0) return { slots, source: 'actual' };
  }

  for (const [minRank, slots] of SLOT_DEFAULTS) {
    if (rank >= minRank) return { slots: slots[discipline], source: 'default' };
  }
  return { slots: 0, source: 'default' };
}

// --- Absorption above the Challenger stack ----------------------------------
// Events above C175 remove players from the Challenger pool without appearing
// in the Challenger stack, but their face draw size wildly overstates the
// removal: most of a Slam's 128 main draw was never going to play a Challenger
// that week. Count only the part of each draw that overlaps the Challenger
// population.
//
// Doubles absorbs far more of its pool proportionally than singles does: a
// Slam's 64-team doubles field is more than four complete Challenger doubles
// draws, drawn from exactly the population that otherwise fills them.

const ABSORPTION: Array<[minRank: number, singles: number, doubles: number]> = [
  // Slam singles: the full 128-slot qualifying draw plus roughly the bottom 20
  // of the main draw. Slam doubles: the entire 64-team field.
  [100, 148, 64],
  [95, 0, 0], // ATP Finals
  [90, 36, 24], // ATP 1000: 24Q + bottom 12 MD ; full doubles field
  [80, 24, 16], // ATP 500: 16Q + bottom 8 MD
  [70, 26, 16], // ATP 250: 16Q + bottom 10 MD
];

/** Absorption decay across a multi-week event. Players losing in the first
 * qualifying round re-enter Challengers the following week, so week 1 removes
 * far more of the pool than week 3 does. Seeded, not fitted — V2/V5 report
 * whether these hold up. */
export const ABSORPTION_DECAY = [1.0, 0.5, 0.25];

/** Slots removed from the Challenger pool by an above-stack event, `weekOffset`
 * weeks after it starts. */
export function absorptionSlots(
  level: string,
  discipline: Discipline,
  weekOffset = 0
): number {
  const rank = levelRank(level);
  if (rank <= CHALLENGER_STACK_TOP) return 0;
  const decay = ABSORPTION_DECAY[weekOffset] ?? 0;
  if (decay === 0) return 0;
  for (const [minRank, singles, doubles] of ABSORPTION) {
    if (rank >= minRank) return (discipline === 'singles' ? singles : doubles) * decay;
  }
  return 0;
}

/** How many weeks an above-stack event keeps absorbing. Slams run a qualifying
 * week plus two main-draw weeks; everything else is a single week. */
export function absorptionSpanWeeks(level: string): number {
  return levelRank(level) === 100 ? 3 : 1;
}

// --- Depth ------------------------------------------------------------------

export type DepthEvent = {
  editionId: string;
  slug: string;
  name: string;
  year: number;
  week: number;
  level: string;
  surface: string;
  indoor: boolean | null;
  latitude: number | null;
  longitude: number | null;
  /** Real singles main draw from tournament_editions, when an importer has
   * written it. null falls back to the per-level default. */
  singlesDrawSize?: number | null;
};

export type DepthContribution = {
  slug: string;
  level: string;
  km: number;
  wGeo: number;
  wSurface: number;
  slots: number;
  /** Slots actually added after every weight and the tier step. */
  contribution: number;
  kind: 'peer' | 'absorption';
};

export type DepthResult = {
  depth: number;
  ownSlots: number;
  slotsAbove: number;
  slotsSource: SlotSource;
  contributions: DepthContribution[];
};

import { haversineKm } from './cut-prediction';

/**
 * depth(i) = da_slots(i) + Σ_j da_slots(j) · w_geo · w_surface · tier_factor
 *
 * tier_factor is 1 when level(j) >= level(i) and 0 below, so only events that
 * are genuine alternatives for the target's population count.
 *
 * Equal-level events count at FULL weight, not half. Two co-equal C100s in one
 * region draw from a single pool and interleave: the weakest accepted team at
 * each sits around the 28th best in the region, not the 21st, so the boundary
 * sits at the combined total. w_geo already discounts same-level events that
 * are not real alternatives, and applying a further tie discount would
 * double-count that.
 */
export function computeDepth(
  target: DepthEvent,
  sameWeek: DepthEvent[],
  discipline: Discipline
): DepthResult {
  const own = daSlots(target.level, discipline, target.singlesDrawSize);
  const targetRank = levelRank(target.level);
  const contributions: DepthContribution[] = [];
  let slotsAbove = 0;

  if (targetRank === 0 || target.latitude == null || target.longitude == null) {
    return {
      depth: own.slots,
      ownSlots: own.slots,
      slotsAbove: 0,
      slotsSource: own.source,
      contributions: [],
    };
  }

  for (const other of sameWeek) {
    if (other.editionId === target.editionId) continue;
    if (other.latitude == null || other.longitude == null) continue;
    const otherRank = levelRank(other.level);
    if (otherRank === 0 || otherRank < targetRank) continue; // tier_factor = 0

    // A Slam's qualifying event is a separate edition row in this schema; its
    // 128 slots are already inside the Slam's absorption figure, so counting
    // the row as well would double-count the entire qualifying draw.
    if (other.level.toLowerCase().includes('grand slam qualifying')) continue;

    const km = haversineKm(
      target.latitude,
      target.longitude,
      other.latitude,
      other.longitude
    );
    const g = wGeo(km);
    const s = wSurface(target, other);

    const above = isAboveChallengerStack(other.level);
    const weekOffset = Math.max(0, target.week - other.week);
    const rawSlots = above
      ? absorptionSlots(other.level, discipline, weekOffset)
      : daSlots(other.level, discipline, other.singlesDrawSize).slots;

    if (rawSlots === 0) continue;
    const contribution = rawSlots * g * s;
    slotsAbove += contribution;
    contributions.push({
      slug: other.slug,
      level: other.level,
      km,
      wGeo: g,
      wSurface: s,
      slots: rawSlots,
      contribution,
      kind: above ? 'absorption' : 'peer',
    });
  }

  contributions.sort((a, b) => b.contribution - a.contribution);
  return {
    depth: own.slots + slotsAbove,
    ownSlots: own.slots,
    slotsAbove,
    slotsSource: own.source,
    contributions,
  };
}

/** Events in scope for a target's week. Above-stack events reach forward by
 * their absorption span, so a Slam still counts in the two weeks after it
 * starts; everything else is same-week only. */
export function sameWeekScope(events: DepthEvent[], year: number, week: number): DepthEvent[] {
  return events.filter((e) => {
    if (e.year !== year) return false;
    const span = absorptionSpanWeeks(e.level);
    return e.week <= week && week - e.week < span;
  });
}

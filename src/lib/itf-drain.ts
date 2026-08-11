// ITF supply in a region, and how much of it actually competes with a
// Challenger for the same players.
//
// ITF events sit BELOW every Challenger, so competitive depth excludes them
// outright (tier_factor is 0 under the target's level). That is right for depth,
// which asks who takes the strong players away, but it misses a real effect in
// the other direction: an M25 down the road gives the players hovering around a
// small Challenger's cut somewhere else to play.
//
// The effect is strongly level-dependent, and getting that wrong would overstate
// it everywhere. A cut is set by the Nth best entrant, so removing players
// ranked WORSE than the cut does not move it at all. ITF fields draw roughly the
// 250-700 band, which means:
//
//   Challenger 50 / 75  — cuts land right inside that band, so an ITF nearby
//                         drains real candidates and the cut moves.
//   Challenger 100/125  — cuts sit above most of the ITF population; the drain
//                         touches only the very bottom of the acceptance list.
//   Challenger 175, ATP, Slams — no overlap worth modelling.
//
// This is reported as visible context next to an event, not folded silently into
// the strength score. The score is measured from real cuts; this is a
// qualitative factor on top, and it has NOT been validated against outcomes.

import { haversineKm } from './cut-prediction';
import { levelGroup, levelRank } from './swings';
import type { DepthEvent } from './depth';

/** Same regional radius the rest of the feature uses. */
export const ITF_REGION_KM = 1500;

/** Typical acceptance places in an ITF singles main draw. */
const ITF_PLACES = 24;

export type ItfExposure = 'high' | 'low' | 'none';

/** How much a level's cut overlaps the population ITF events draw from. */
export function itfExposure(level: string): ItfExposure {
  if (levelGroup(level) !== 'challenger') return 'none';
  const rank = levelRank(level);
  if (rank <= 47) return 'high'; // Challenger 50, 75, 80 and unlabelled
  if (rank <= 55) return 'low'; // Challenger 100, 125
  return 'none'; // Challenger 175
}

export type ItfNearby = {
  events: number;
  places: number;
  exposure: ItfExposure;
};

/**
 * ITF events within reach of `target` in the same week.
 *
 * Counts events and approximate places. Places are a per-level estimate — ITF
 * draw sizes are not imported — so this is deliberately coarse.
 */
export function itfNearby(target: DepthEvent, weekEvents: DepthEvent[]): ItfNearby {
  const exposure = itfExposure(target.level);
  if (target.latitude == null || target.longitude == null) {
    return { events: 0, places: 0, exposure };
  }
  let events = 0;
  for (const e of weekEvents) {
    if (e.editionId === target.editionId) continue;
    if (levelGroup(e.level) !== 'itf') continue;
    if (e.latitude == null || e.longitude == null) continue;
    if (haversineKm(target.latitude, target.longitude, e.latitude, e.longitude) > ITF_REGION_KM) {
      continue;
    }
    events++;
  }
  return { events, places: events * ITF_PLACES, exposure };
}

/** One-line explanation, or null when the level has no meaningful overlap. */
export function itfNote(n: ItfNearby): string | null {
  if (n.events === 0 || n.exposure === 'none') return null;
  const plural = n.events === 1 ? 'event' : 'events';
  return n.exposure === 'high'
    ? `${n.events} ITF ${plural} in range (~${n.places} places) — at this level they pull from the same band as the cut`
    : `${n.events} ITF ${plural} in range (~${n.places} places) — mostly below this cut, so the pull is small`;
}

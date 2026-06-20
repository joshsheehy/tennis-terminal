// Custom swing builder (Swings phase 3b). Pure, client-usable ranking so a
// player can start from one tournament and assemble their own chain. Given an
// anchor stop, candidates in the following week(s) are ranked
// same city -> same country -> neighboring country -> same region -> far,
// reusing the same geography helpers as auto-detection.

import {
  areNeighboringCountries,
  continentForCountry,
  countryDisplayName,
  haversineKm,
  levelRank,
  surfaceFamily,
} from './swings';

export interface BuildEvent {
  editionId: string;
  city: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  week: number;
  surface: string;
  level: string;
}

export type CandidateTier = 'same-city' | 'same-country' | 'neighbor' | 'same-region' | 'far';

/** Ranking order, strongest relationship first. */
export const TIER_ORDER: CandidateTier[] = [
  'same-city',
  'same-country',
  'neighbor',
  'same-region',
  'far',
];

export const TIER_LABELS: Record<CandidateTier, string> = {
  'same-city': 'Same city',
  'same-country': 'Same country',
  neighbor: 'Neighboring country',
  'same-region': 'Same region',
  far: 'Further afield',
};

export type RankedCandidate<T extends BuildEvent = BuildEvent> = {
  event: T;
  tier: CandidateTier;
  distanceKm: number | null;
  weekGap: number;
  sameSurface: boolean;
};

function cleanCity(city: string): string {
  return city
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sameCountry(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return countryDisplayName(a).toLowerCase() === countryDisplayName(b).toLowerCase();
}

function distanceBetween(a: BuildEvent, b: BuildEvent): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
}

/** Relationship tier of a candidate relative to the anchor (last stop). */
export function classifyRelation(
  anchor: BuildEvent,
  candidate: BuildEvent
): { tier: CandidateTier; distanceKm: number | null } {
  const distanceKm = distanceBetween(anchor, candidate);

  const anchorCity = cleanCity(anchor.city);
  if (anchorCity && anchorCity === cleanCity(candidate.city)) {
    return { tier: 'same-city', distanceKm };
  }
  if (sameCountry(anchor.country, candidate.country)) {
    return { tier: 'same-country', distanceKm };
  }
  if (anchor.country && candidate.country && areNeighboringCountries(anchor.country, candidate.country)) {
    return { tier: 'neighbor', distanceKm };
  }

  const regionA = continentForCountry(anchor.country);
  const regionB = continentForCountry(candidate.country);
  if (regionA && regionB && regionA === regionB) {
    return { tier: 'same-region', distanceKm };
  }
  // Unknown countries: fall back to a generous distance band for "region".
  if ((!anchor.country || !candidate.country) && distanceKm != null && distanceKm <= 1500) {
    return { tier: 'same-region', distanceKm };
  }
  return { tier: 'far', distanceKm };
}

/**
 * Rank the tournaments a player could go to after `anchor`. By default this
 * covers the next `maxWeekGap` weeks; pass `week` to restrict to one exact
 * week (the builder offers one week at a time). Sorted by relationship tier,
 * then sooner week, then nearer distance.
 */
export function buildCandidates<T extends BuildEvent>(
  events: T[],
  anchor: T,
  options: { maxWeekGap?: number; week?: number; excludeEditionIds?: Iterable<string> } = {}
): RankedCandidate<T>[] {
  const maxWeekGap = options.maxWeekGap ?? 3;
  const exclude = new Set(options.excludeEditionIds ?? []);
  exclude.add(anchor.editionId);

  const inRange = (week: number) =>
    options.week != null
      ? week === options.week && week > anchor.week
      : week > anchor.week && week <= anchor.week + maxWeekGap;

  const anchorFamily = surfaceFamily(anchor.surface);
  const ranked = events
    .filter((e) => !exclude.has(e.editionId) && inRange(e.week))
    .map((event) => {
      const { tier, distanceKm } = classifyRelation(anchor, event);
      return {
        event,
        tier,
        distanceKm,
        weekGap: event.week - anchor.week,
        sameSurface: surfaceFamily(event.surface) === anchorFamily,
      };
    });

  // Within a relationship tier, show the highest levels first (a player wants
  // to see the biggest events in-country at the top), then sooner week, then
  // nearer distance.
  ranked.sort(
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      levelRank(b.event.level) - levelRank(a.event.level) ||
      a.weekGap - b.weekGap ||
      (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER)
  );
  return ranked;
}

export type ChainSummary = {
  totalWeeks: number;
  startWeek: number;
  endWeek: number;
  countries: string[];
  surfaces: string[];
  surfaceConsistent: boolean;
  /** Longest single hop in km between consecutive stops, or null if unknown. */
  maxHopKm: number | null;
};

/** Summarize an ordered custom chain for the builder panel. */
export function summarizeChain(chain: BuildEvent[]): ChainSummary | null {
  if (chain.length === 0) return null;
  const weeks = chain.map((e) => e.week);
  const countries: string[] = [];
  for (const e of chain) {
    if (!e.country) continue;
    const name = countryDisplayName(e.country);
    if (!countries.includes(name)) countries.push(name);
  }
  const surfaces = [...new Set(chain.map((e) => e.surface))];
  let maxHopKm: number | null = null;
  for (let i = 1; i < chain.length; i += 1) {
    const d = distanceBetween(chain[i - 1], chain[i]);
    if (d != null) maxHopKm = Math.max(maxHopKm ?? 0, d);
  }
  return {
    totalWeeks: Math.max(...weeks) - Math.min(...weeks) + 1,
    startWeek: Math.min(...weeks),
    endWeek: Math.max(...weeks),
    countries,
    surfaces,
    surfaceConsistent: surfaces.length === 1,
    maxHopKm,
  };
}

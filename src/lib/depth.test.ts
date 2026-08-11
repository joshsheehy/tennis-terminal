import { describe, it, expect } from 'vitest';
import {
  levelRank,
  isAboveChallengerStack,
  wGeo,
  wSurface,
  daSlots,
  absorptionSlots,
  absorptionSpanWeeks,
  computeDepth,
  sameWeekScope,
  type DepthEvent,
} from './depth';

const ev = (over: Partial<DepthEvent> & { editionId: string }): DepthEvent => ({
  slug: over.editionId,
  name: over.editionId,
  year: 2026,
  week: 36,
  level: 'Challenger 100',
  surface: 'Clay',
  indoor: false,
  latitude: 0,
  longitude: 0,
  ...over,
});

// Approximate host cities for the motivating week.
const MADRID = { latitude: 40.4, longitude: -3.7 };
const ROME = { latitude: 41.9, longitude: 12.5 };
const LYON = { latitude: 45.8, longitude: 4.8 };

// levelRank itself lives in swings.ts and is shared with swing detection;
// these cover the two gaps depth needed closed there.
describe('levelRank', () => {
  it('orders the full hierarchy', () => {
    const order = [
      'Grand Slam',
      'ATP Finals',
      'ATP 1000',
      'ATP 500',
      'ATP 250',
      'Challenger 175',
      'Challenger 125',
      'Challenger 100',
      'Challenger 80',
      'Challenger 75',
      'Challenger 50',
      'ITF M25',
    ];
    const ranks = order.map((l) => levelRank(l));
    expect(ranks.every((r) => r > 0)).toBe(true);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]).toBeGreaterThan(ranks[i]);
    }
  });

  it('does not let ATP levels fall through to the Challenger branch', () => {
    // "ATP 500" contains "50"; a naive substring order would rank it as a C50.
    expect(levelRank('ATP 500')).toBeGreaterThan(levelRank('Challenger 175'));
    expect(levelRank('ATP 250')).toBeGreaterThan(levelRank('Challenger 175'));
  });

  it('places the legacy Challenger 80 level between 100 and 75', () => {
    // Previously fell through to the generic Challenger branch and sorted
    // below Challenger 50.
    expect(levelRank('Challenger 80')).toBeLessThan(levelRank('Challenger 100'));
    expect(levelRank('Challenger 80')).toBeGreaterThan(levelRank('Challenger 75'));
    expect(levelRank('Challenger 80')).toBeGreaterThan(levelRank('Challenger 50'));
  });

  it('ranks the ATP Finals above ATP 1000 instead of scoring it 0', () => {
    expect(levelRank('ATP Finals')).toBeGreaterThan(levelRank('ATP 1000'));
  });

  it('marks only levels above C175 as above the Challenger stack', () => {
    expect(isAboveChallengerStack('ATP 250')).toBe(true);
    expect(isAboveChallengerStack('Grand Slam')).toBe(true);
    expect(isAboveChallengerStack('Challenger 175')).toBe(false);
    expect(isAboveChallengerStack('Challenger 125')).toBe(false);
  });
});

describe('wGeo', () => {
  it('decays continuously and floors at 0.03', () => {
    expect(wGeo(0)).toBe(1);
    expect(wGeo(1200)).toBeCloseTo(Math.exp(-1), 6);
    expect(wGeo(50000)).toBe(0.03);
  });

  it('separates cases the old 3000km cutoff collapsed together', () => {
    // Istanbul-ish (just outside the old cutoff) still contributes; a
    // 2900km neighbour no longer counts the same as a 100km one.
    expect(wGeo(3100)).toBeGreaterThan(0.03);
    expect(wGeo(2900)).toBeLessThan(wGeo(100) / 5);
  });
});

describe('wSurface', () => {
  const hard = { surface: 'Hard', indoor: false };
  const indoorHard = { surface: 'Hard', indoor: true };
  const clay = { surface: 'Clay', indoor: false };
  const grass = { surface: 'Grass', indoor: false };

  it('scores identical conditions at 1.0', () => {
    expect(wSurface(hard, hard)).toBe(1.0);
  });

  it('scores hard vs indoor hard at 0.85', () => {
    expect(wSurface(hard, indoorHard)).toBe(0.85);
  });

  it('scores clay vs hard at 0.55 in both directions', () => {
    expect(wSurface(clay, hard)).toBe(0.55);
    expect(wSurface(hard, clay)).toBe(0.55);
  });

  it('scores grass against anything else at 0.3', () => {
    expect(wSurface(grass, hard)).toBe(0.3);
    expect(wSurface(grass, clay)).toBe(0.3);
    expect(wSurface(grass, grass)).toBe(1.0);
  });

  it('never returns zero', () => {
    expect(wSurface(grass, indoorHard)).toBeGreaterThan(0);
  });

  it('treats carpet as indoor hard', () => {
    expect(wSurface({ surface: 'Carpet', indoor: null }, indoorHard)).toBe(1.0);
  });
});

describe('daSlots', () => {
  it('counts doubles in teams, not players', () => {
    expect(daSlots('Challenger 100', 'doubles').slots).toBe(14);
    expect(daSlots('Challenger 125', 'doubles').slots).toBe(14);
  });

  it('reports source as default while draw-size columns are unpopulated', () => {
    expect(daSlots('Challenger 100', 'singles').source).toBe('default');
  });

  it('gives the ATP Finals no cut-setting slots', () => {
    expect(daSlots('ATP Finals', 'singles').slots).toBe(0);
    expect(daSlots('ATP Finals', 'doubles').slots).toBe(0);
  });
});

describe('absorption', () => {
  it('removes the whole Slam doubles field but only part of the singles draw', () => {
    // Slam singles: 128 qualifying + bottom of the main draw, not all 128 MD.
    expect(absorptionSlots('Grand Slam', 'singles')).toBe(148);
    expect(absorptionSlots('Grand Slam', 'doubles')).toBe(64);
  });

  it('removes more than four Challenger doubles draws for a Slam', () => {
    const challengerDraw = daSlots('Challenger 100', 'doubles').slots;
    expect(absorptionSlots('Grand Slam', 'doubles') / challengerDraw).toBeGreaterThan(4);
  });

  it('decays across the Slam span and stops after it', () => {
    expect(absorptionSlots('Grand Slam', 'doubles', 0)).toBe(64);
    expect(absorptionSlots('Grand Slam', 'doubles', 1)).toBe(32);
    expect(absorptionSlots('Grand Slam', 'doubles', 2)).toBe(16);
    expect(absorptionSlots('Grand Slam', 'doubles', 3)).toBe(0);
  });

  it('does not absorb from inside the Challenger stack', () => {
    expect(absorptionSlots('Challenger 175', 'singles')).toBe(0);
    expect(absorptionSlots('Challenger 125', 'doubles')).toBe(0);
  });

  it('spans three weeks for a Slam and one for everything else', () => {
    expect(absorptionSpanWeeks('Grand Slam')).toBe(3);
    expect(absorptionSpanWeeks('ATP 250')).toBe(1);
  });
});

describe('computeDepth', () => {
  it('ignores events below the target level (tier_factor = 0)', () => {
    const target = ev({ editionId: 'c100', level: 'Challenger 100', ...LYON });
    const below = ev({ editionId: 'c75', level: 'Challenger 75', ...ROME });
    const r = computeDepth(target, [target, below], 'doubles');
    expect(r.slotsAbove).toBe(0);
    expect(r.depth).toBe(14);
  });

  it('counts an equal-level neighbour at full weight, not half', () => {
    const a = ev({ editionId: 'a', level: 'Challenger 100', latitude: 45, longitude: 5 });
    const b = ev({ editionId: 'b', level: 'Challenger 100', latitude: 45, longitude: 5 });
    const r = computeDepth(a, [a, b], 'doubles');
    // Co-located, same surface: the full 14 teams come across.
    expect(r.slotsAbove).toBeCloseTo(14, 6);
    expect(r.depth).toBeCloseTo(28, 6);
  });

  it('counts a higher-level neighbour through absorption, not face draw size', () => {
    const target = ev({ editionId: 'c100', level: 'Challenger 100', ...LYON });
    const slam = ev({
      editionId: 'slam',
      level: 'Grand Slam',
      surface: 'Hard',
      indoor: false,
      ...LYON,
    });
    const r = computeDepth(target, [target, slam], 'doubles');
    const contrib = r.contributions.find((c) => c.slug === 'slam')!;
    expect(contrib.kind).toBe('absorption');
    expect(contrib.slots).toBe(64); // not the 64-team draw's face value by accident
    expect(contrib.wSurface).toBe(0.55); // clay target vs hard slam
  });

  it('does not double-count a Slam qualifying edition row', () => {
    const target = ev({ editionId: 'c100', ...LYON });
    const slam = ev({ editionId: 's', level: 'Grand Slam', ...LYON });
    const slamQuali = ev({ editionId: 'sq', level: 'Grand Slam qualifying', ...LYON });
    const withQuali = computeDepth(target, [target, slam, slamQuali], 'singles');
    const withoutQuali = computeDepth(target, [target, slam], 'singles');
    expect(withQuali.depth).toBeCloseTo(withoutQuali.depth, 6);
  });

  it('falls back to own slots when the target has no coordinates', () => {
    const target = ev({ editionId: 'x', latitude: null, longitude: null });
    const other = ev({ editionId: 'y', level: 'Challenger 125', ...ROME });
    const r = computeDepth(target, [target, other], 'doubles');
    expect(r.depth).toBe(14);
  });
});

// V4 from the build spec, run as a unit test so it is checked on every commit
// rather than only against production data.
describe('V4 — the motivating week', () => {
  const y2025: DepthEvent[] = [
    ev({ editionId: '25-es', year: 2025, level: 'Challenger 125', ...MADRID }),
    ev({ editionId: '25-it', year: 2025, level: 'Challenger 100', ...ROME }),
    ev({ editionId: '25-fr', year: 2025, level: 'Challenger 75', ...LYON }),
  ];
  const y2026: DepthEvent[] = [
    ev({ editionId: '26-fr', year: 2026, level: 'Challenger 100', ...LYON }),
    ev({ editionId: '26-it', year: 2026, level: 'Challenger 75', ...ROME }),
  ];

  it('gives the 2026 Challenger 100 in France a depth of 14', () => {
    const target = y2026[0];
    const r = computeDepth(target, y2026, 'doubles');
    // Only a C75 remains beside it, which is below its level, so nothing is
    // absorbed above it and depth collapses to its own draw.
    expect(r.slotsAbove).toBe(0);
    expect(r.depth).toBe(14);
  });

  it('selects the 2025 Challenger 125 in Spain as the nearest positional comp', () => {
    const targetDepth = computeDepth(y2026[0], y2026, 'doubles').depth;
    const comps = y2025
      .filter((e) => e.level !== 'Challenger 75')
      .map((e) => ({
        slug: e.editionId,
        depth: computeDepth(e, y2025, 'doubles').depth,
      }))
      .map((c) => ({ ...c, distance: Math.abs(c.depth - targetDepth) }))
      .sort((a, b) => a.distance - b.distance);

    expect(comps[0].slug).toBe('25-es');
    // The 2025 C100 in Italy had the Spanish 125 above it, so it sat deeper
    // and is NOT the comp — selecting it would mean the weighting is broken.
    expect(comps[1].slug).toBe('25-it');
    expect(comps[1].depth).toBeGreaterThan(comps[0].depth);
  });
});

describe('sameWeekScope', () => {
  it('reaches a Slam forward across its absorption span but not beyond', () => {
    const slam = ev({ editionId: 's', level: 'Grand Slam', week: 34, year: 2026 });
    const chall = ev({ editionId: 'c', level: 'Challenger 100', week: 34, year: 2026 });
    const all = [slam, chall];
    expect(sameWeekScope(all, 2026, 34).map((e) => e.editionId)).toEqual(['s', 'c']);
    expect(sameWeekScope(all, 2026, 36).map((e) => e.editionId)).toEqual(['s']);
    expect(sameWeekScope(all, 2026, 37).map((e) => e.editionId)).toEqual([]);
  });

  it('does not mix years', () => {
    const a = ev({ editionId: 'a', year: 2025, week: 36 });
    expect(sameWeekScope([a], 2026, 36)).toEqual([]);
  });
});

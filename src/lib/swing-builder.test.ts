import { describe, expect, it } from 'vitest';
import { BuildEvent, buildCandidates, classifyRelation, summarizeChain } from './swing-builder';

let n = 0;
function ev(o: Partial<BuildEvent>): BuildEvent {
  n += 1;
  return {
    editionId: `e${n}`,
    city: `City ${n}`,
    country: 'United States',
    latitude: 40,
    longitude: -75,
    week: 30,
    surface: 'Hard',
    ...o,
  };
}

const cary = { city: 'Cary', country: 'United States', latitude: 35.79, longitude: -78.78 };
const winnipeg = { city: 'Winnipeg', country: 'Canada', latitude: 49.9, longitude: -97.14 };
const granby = { city: 'Granby', country: 'Canada', latitude: 45.4, longitude: -72.73 };
const lexington = { city: 'Lexington', country: 'United States', latitude: 38.04, longitude: -84.5 };
const valencia = { city: 'Valencia', country: 'Spain', latitude: 39.47, longitude: -0.38 };

describe('classifyRelation', () => {
  it('ranks same city highest', () => {
    const a = ev({ ...cary, week: 30 });
    const b = ev({ city: 'Cary', country: 'United States', latitude: 35.79, longitude: -78.78, week: 31 });
    expect(classifyRelation(a, b).tier).toBe('same-city');
  });

  it('ranks same country above a neighbor', () => {
    expect(classifyRelation(ev(cary), ev(lexington)).tier).toBe('same-country');
    expect(classifyRelation(ev(cary), ev(winnipeg)).tier).toBe('neighbor'); // US–Canada neighbors
  });

  it('ranks a far different-continent country as far', () => {
    expect(classifyRelation(ev(cary), ev(valencia)).tier).toBe('far');
  });

  it('normalizes country name variants for same-country', () => {
    const a = ev({ country: 'USA', city: 'Dallas' });
    const b = ev({ country: 'United States', city: 'Houston' });
    expect(classifyRelation(a, b).tier).toBe('same-country');
  });
});

describe('buildCandidates', () => {
  it('only offers tournaments in the weeks after the anchor', () => {
    const anchor = ev({ ...cary, week: 30 });
    const events = [
      anchor,
      ev({ ...lexington, week: 31 }),
      ev({ ...granby, week: 32 }),
      ev({ ...cary, week: 29 }), // before anchor -> excluded
      ev({ ...valencia, week: 40 }), // beyond default 3-week window -> excluded
    ];
    const out = buildCandidates(events, anchor);
    expect(out.map((c) => c.event.week).sort()).toEqual([31, 32]);
  });

  it('orders same-country before neighbor before far', () => {
    const anchor = ev({ ...cary, week: 30 });
    const sameCountry = ev({ ...lexington, week: 31 });
    const neighbor = ev({ ...granby, week: 31 });
    const far = ev({ ...valencia, week: 31 });
    const out = buildCandidates([anchor, far, neighbor, sameCountry], anchor);
    expect(out.map((c) => c.tier)).toEqual(['same-country', 'neighbor', 'far']);
  });

  it('excludes editions already in the chain', () => {
    const anchor = ev({ ...cary, week: 30 });
    const next = ev({ ...lexington, week: 31 });
    const out = buildCandidates([anchor, next], anchor, { excludeEditionIds: [next.editionId] });
    expect(out).toHaveLength(0);
  });

  it('flags surface continuity', () => {
    const anchor = ev({ ...cary, week: 30, surface: 'Hard' });
    const clay = ev({ ...lexington, week: 31, surface: 'Clay' });
    const indoor = ev({ ...lexington, week: 31, surface: 'Indoor Hard' });
    const out = buildCandidates([anchor, clay, indoor], anchor);
    expect(out.find((c) => c.event.editionId === clay.editionId)!.sameSurface).toBe(false);
    expect(out.find((c) => c.event.editionId === indoor.editionId)!.sameSurface).toBe(true);
  });
});

describe('summarizeChain', () => {
  it('summarizes weeks, countries, surfaces and the longest hop', () => {
    const chain = [
      ev({ ...cary, week: 30, surface: 'Hard' }),
      ev({ ...winnipeg, week: 31, surface: 'Hard' }),
      ev({ ...granby, week: 32, surface: 'Hard' }),
    ];
    const s = summarizeChain(chain)!;
    expect(s.totalWeeks).toBe(3);
    expect(s.startWeek).toBe(30);
    expect(s.endWeek).toBe(32);
    expect(s.countries).toEqual(['US', 'Canada']);
    expect(s.surfaceConsistent).toBe(true);
    expect(s.maxHopKm).toBeGreaterThan(0);
  });

  it('returns null for an empty chain', () => {
    expect(summarizeChain([])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWING_CONFIG,
  SwingEventInput,
  allLevelScopes,
  areNeighboringCountries,
  continentForCountry,
  detectSwings,
  eventsConnect,
  formatTierMix,
  haversineKm,
  levelGroup,
  parseScopeKey,
  scopeKey,
  surfaceFamily,
} from './swings';

const NO_NEIGHBOR_RULE = { ...DEFAULT_SWING_CONFIG, requireNeighboringCountries: false };
const NO_SURFACE_SPLIT = { ...DEFAULT_SWING_CONFIG, splitOnSurfaceChange: false };

let counter = 0;

function ev(overrides: Partial<SwingEventInput>): SwingEventInput {
  counter += 1;
  return {
    editionId: `edition-${counter}`,
    tournamentId: `tournament-${counter}`,
    slug: `slug-${counter}`,
    name: overrides.name ?? `Event ${counter}`,
    city: 'City',
    country: 'Portugal',
    latitude: 38.7,
    longitude: -9.1,
    week: 1,
    startDate: '2026-01-05',
    level: 'Challenger 75',
    surface: 'Clay',
    indoor: false,
    ...overrides,
  };
}

const lisbon = { country: 'Portugal', latitude: 38.7223, longitude: -9.1393 };
const oeiras = { country: 'Portugal', latitude: 38.6979, longitude: -9.3017 };
const vigo = { country: 'Spain', latitude: 42.2406, longitude: -8.7207 };
const barcelona = { country: 'Spain', latitude: 41.3874, longitude: 2.1686 };
const tangier = { country: 'Morocco', latitude: 35.7806, longitude: -5.8137 };
const malaga = { country: 'Spain', latitude: 36.7213, longitude: -4.4214 };
const losAngeles = { country: 'United States', latitude: 34.0549, longitude: -118.2426 };
const newYork = { country: 'United States', latitude: 40.7128, longitude: -74.006 };
const munich = { country: 'Germany', latitude: 48.137, longitude: 11.575 };
const bolzano = { country: 'Italy', latitude: 46.498, longitude: 11.354 };

describe('haversineKm', () => {
  it('computes known distances', () => {
    // Paris <-> London is ~344 km.
    const d = haversineKm(48.8566, 2.3522, 51.5072, -0.1276);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });
});

describe('continentForCountry', () => {
  it('maps tennis country spellings', () => {
    expect(continentForCountry('China, P.R.')).toBe('Asia');
    expect(continentForCountry('USA')).toBe('North America');
    expect(continentForCountry('Côte d\'Ivoire')).toBe('Africa');
    expect(continentForCountry(null)).toBeNull();
    expect(continentForCountry('Atlantis')).toBeNull();
  });
});

describe('eventsConnect', () => {
  it('always connects same-country pairs, even US coast-to-coast (> threshold)', () => {
    const a = ev({ ...losAngeles, week: 1 });
    const b = ev({ ...newYork, week: 2 });
    expect(haversineKm(a.latitude!, a.longitude!, b.latitude!, b.longitude!)).toBeGreaterThan(600);
    expect(eventsConnect(a, b)).toBe(true);
  });

  it('connects same-country pairs even without coordinates', () => {
    const a = ev({ country: 'Portugal', latitude: null, longitude: null, week: 1 });
    const b = ev({ country: 'Portugal', latitude: null, longitude: null, week: 2 });
    expect(eventsConnect(a, b)).toBe(true);
  });

  it('connects neighboring cross-border pairs within the km threshold', () => {
    // Portugal and Spain are neighbors; Lisbon–Vigo is < 600 km.
    expect(eventsConnect(ev({ ...lisbon, week: 1 }), ev({ ...vigo, week: 2 }))).toBe(true);
  });

  it('rejects cross-border pairs beyond the km threshold', () => {
    expect(eventsConnect(ev({ ...lisbon, week: 1 }), ev({ ...barcelona, week: 2 }))).toBe(false);
  });

  it('rejects non-neighboring countries even when within the km threshold', () => {
    // Munich (DE) and Bolzano (IT) are ~180 km apart, same continent, but
    // Germany and Italy are not neighbors (Austria/Switzerland sit between).
    const a = ev({ ...munich, week: 1 });
    const b = ev({ ...bolzano, week: 2 });
    expect(haversineKm(a.latitude!, a.longitude!, b.latitude!, b.longitude!)).toBeLessThan(600);
    expect(eventsConnect(a, b)).toBe(false);
    // With the neighbor rule disabled, distance alone would connect them.
    expect(eventsConnect(a, b, NO_NEIGHBOR_RULE)).toBe(true);
  });

  it('rejects continent hops even when geographically close', () => {
    const a = ev({ ...malaga, week: 1 });
    const b = ev({ ...tangier, week: 2 });
    expect(haversineKm(a.latitude!, a.longitude!, b.latitude!, b.longitude!)).toBeLessThan(600);
    expect(eventsConnect(a, b)).toBe(false);
  });

  it('breaks the chain on a surface-family change, even same country', () => {
    const a = ev({ ...lisbon, week: 1, surface: 'Clay' });
    const b = ev({ ...lisbon, week: 2, surface: 'Grass' });
    expect(eventsConnect(a, b)).toBe(false);
    expect(eventsConnect(a, b, NO_SURFACE_SPLIT)).toBe(true);
  });

  it('treats Hard and Indoor Hard as the same surface family', () => {
    expect(surfaceFamily('Hard')).toBe(surfaceFamily('Indoor Hard'));
    const a = ev({ ...lisbon, week: 1, surface: 'Hard' });
    const b = ev({ ...lisbon, week: 2, surface: 'Indoor Hard' });
    expect(eventsConnect(a, b)).toBe(true);
  });

  it('rejects cross-border pairs without coordinates', () => {
    const a = ev({ country: 'Portugal', latitude: null, longitude: null, week: 1 });
    const b = ev({ ...vigo, week: 2 });
    expect(eventsConnect(a, b)).toBe(false);
  });

  it('falls back to distance when a country is unknown (pre-backfill data)', () => {
    // Two coordinate-bearing events with no country resolve by distance.
    const a = ev({ country: null, latitude: 12.97, longitude: 77.59, week: 1 });
    const b = ev({ country: null, latitude: 12.98, longitude: 77.6, week: 2 });
    expect(eventsConnect(a, b)).toBe(true);
  });

  it('honors a tuned km threshold for cross-border pairs only', () => {
    const wide = { ...DEFAULT_SWING_CONFIG, crossBorderMaxKm: 1200 };
    expect(eventsConnect(ev({ ...lisbon, week: 1 }), ev({ ...barcelona, week: 2 }), wide)).toBe(true);
    const narrow = { ...DEFAULT_SWING_CONFIG, crossBorderMaxKm: 100 };
    expect(eventsConnect(ev({ ...lisbon, week: 1 }), ev({ ...vigo, week: 2 }), narrow)).toBe(false);
    // Same-country is untouched by tuning.
    expect(eventsConnect(ev({ ...losAngeles, week: 1 }), ev({ ...newYork, week: 2 }), narrow)).toBe(true);
  });
});

describe('areNeighboringCountries', () => {
  it('recognizes land and curated sea neighbors', () => {
    expect(areNeighboringCountries('Portugal', 'Spain')).toBe(true);
    expect(areNeighboringCountries('United States', 'Canada')).toBe(true);
    expect(areNeighboringCountries('Qatar', 'UAE')).toBe(true);
    expect(areNeighboringCountries('Italy', 'Croatia')).toBe(true);
  });

  it('rejects non-neighbors and normalizes name variants', () => {
    expect(areNeighboringCountries('Germany', 'Italy')).toBe(false);
    expect(areNeighboringCountries('USA', 'Canada')).toBe(true); // USA == United States
    expect(areNeighboringCountries('Great Britain', 'Ireland')).toBe(true); // GB == UK
  });
});

describe('level groups and scopes', () => {
  it('classifies levels', () => {
    expect(levelGroup('ATP 250')).toBe('atp');
    expect(levelGroup('Grand Slam')).toBe('atp');
    expect(levelGroup('Challenger 75')).toBe('challenger');
    expect(levelGroup('ITF M25')).toBe('itf');
    expect(levelGroup('Exhibition')).toBeNull();
  });

  it('round-trips canonical scope keys', () => {
    expect(scopeKey(['challenger', 'atp'])).toBe('atp+challenger');
    expect(scopeKey(['itf'])).toBe('itf');
    expect(parseScopeKey('itf+atp')).toEqual(['atp', 'itf']);
  });

  it('enumerates all seven non-empty scopes', () => {
    const keys = allLevelScopes().map(scopeKey);
    expect(keys).toHaveLength(7);
    expect(keys).toContain('atp+challenger');
    expect(keys).toContain('atp+challenger+itf');
    expect(keys).toContain('itf');
  });
});

describe('detectSwings', () => {
  it('chains consecutive same-city events (Tenerife 1 -> Tenerife 2)', () => {
    const tenerife = { country: 'Spain', latitude: 28.2916, longitude: -16.6291 };
    const swings = detectSwings([
      ev({ ...tenerife, name: 'Tenerife 1', week: 4 }),
      ev({ ...tenerife, name: 'Tenerife 2', week: 5 }),
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].startWeek).toBe(4);
    expect(swings[0].endWeek).toBe(5);
    expect(swings[0].label).toBe('Spain swing');
  });

  it('builds multi-city same-country chains and labels them by country', () => {
    const swings = detectSwings([
      ev({ ...lisbon, week: 28 }),
      ev({ ...oeiras, week: 29 }),
      ev({ ...lisbon, week: 30 }),
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].totalWeeks).toBe(3);
    expect(swings[0].label).toBe('Portugal swing');
    expect(swings[0].countries).toEqual(['Portugal']);
  });

  it('keeps same-week events as alternatives within one swing, not duplicates', () => {
    const swings = detectSwings([
      ev({ ...lisbon, name: 'Lisboa Open', week: 28 }),
      ev({ ...oeiras, name: 'Oeiras Open', week: 28 }),
      ev({ ...lisbon, name: 'Porto Open', week: 29 }),
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].weeks[0].events.map((e) => e.name)).toEqual(['Lisboa Open', 'Oeiras Open']);
    expect(swings[0].weeks[1].events.map((e) => e.name)).toEqual(['Porto Open']);
  });

  it('breaks chains at a gap week', () => {
    const swings = detectSwings([
      ev({ ...lisbon, week: 10 }),
      ev({ ...oeiras, week: 11 }),
      // week 12 gap
      ev({ ...lisbon, week: 13 }),
      ev({ ...oeiras, week: 14 }),
    ]);
    expect(swings).toHaveLength(2);
    expect(swings[0].startWeek).toBe(10);
    expect(swings[0].endWeek).toBe(11);
    expect(swings[1].startWeek).toBe(13);
    expect(swings[1].endWeek).toBe(14);
  });

  it('ignores isolated events and same-week-only pairs (below min length)', () => {
    const swings = detectSwings([
      ev({ ...lisbon, week: 10 }),
      ev({ ...oeiras, week: 10 }),
      ev({ ...barcelona, week: 20 }),
    ]);
    expect(swings).toHaveLength(0);
  });

  it('merges cross-border hops into multi-country swings with joined labels', () => {
    const swings = detectSwings([
      ev({ ...lisbon, week: 1 }),
      ev({ ...vigo, week: 2 }),
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].label).toBe('Portugal–Spain swing');
    expect(swings[0].countries).toEqual(['Portugal', 'Spain']);
  });

  it('tags surface consistency and tier mix', () => {
    // Hard + Indoor Hard are one family so the chain holds, but the raw
    // surfaces differ, so the swing is flagged surface-inconsistent.
    const swings = detectSwings([
      ev({ ...lisbon, week: 1, level: 'Challenger 75', surface: 'Hard' }),
      ev({ ...oeiras, week: 2, level: 'Challenger 50', surface: 'Indoor Hard' }),
      ev({ ...lisbon, week: 3, level: 'Challenger 50', surface: 'Hard' }),
    ]);
    expect(swings[0].surfaceConsistent).toBe(false);
    expect(swings[0].surfaces.sort()).toEqual(['Hard', 'Indoor Hard']);
    expect(swings[0].tierMix).toBe('CH75 + 2× CH50');

    const consistent = detectSwings([
      ev({ ...lisbon, week: 1, surface: 'Clay' }),
      ev({ ...oeiras, week: 2, surface: 'Clay' }),
    ]);
    expect(consistent[0].surfaceConsistent).toBe(true);
  });

  it('keeps a short same-city run (<=3 weeks) as a swing', () => {
    const tenerife = { country: 'Spain', latitude: 28.29, longitude: -16.63 };
    const swings = detectSwings([
      ev({ ...tenerife, city: 'Tenerife 1', week: 4 }),
      ev({ ...tenerife, city: 'Tenerife 2', week: 5 }),
      ev({ ...tenerife, city: 'Tenerife 3', week: 6 }),
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].kind).toBe('swing');
  });

  it('reclassifies a long single-city run as a series, not a swing', () => {
    const sharm = { country: 'Egypt', latitude: 27.91, longitude: 34.33, surface: 'Hard' };
    const swings = detectSwings(
      [4, 5, 6, 7, 8].map((week) => ev({ ...sharm, city: 'Sharm El Sheikh', week }))
    );
    expect(swings).toHaveLength(1);
    expect(swings[0].kind).toBe('series');
    expect(swings[0].label).toBe('Sharm El Sheikh series');
    expect(swings[0].totalWeeks).toBe(5); // not split
    expect(swings[0].cities).toEqual(['Sharm El Sheikh']);
  });

  it('caps a long multi-city chain by splitting at the biggest travel jump', () => {
    const east = { country: 'United States', latitude: 40.7, longitude: -74.0, surface: 'Hard' };
    const west = { country: 'United States', latitude: 34.05, longitude: -118.24, surface: 'Hard' };
    const events = [
      ...[1, 2, 3, 4, 5].map((week) => ev({ ...east, city: `East ${week}`, week })),
      ...[6, 7, 8, 9].map((week) => ev({ ...west, city: `West ${week}`, week })),
    ];
    const swings = detectSwings(events);
    expect(swings).toHaveLength(2);
    expect(swings.every((s) => s.totalWeeks <= 8)).toBe(true);
    expect(swings[0].endWeek).toBe(5); // split at the coast-to-coast jump
    expect(swings[1].startWeek).toBe(6);
  });

  it('splits a same-country chain at a surface change into separate swings', () => {
    // Three clay weeks then two grass weeks in one country -> two swings.
    const swings = detectSwings([
      ev({ ...lisbon, week: 20, surface: 'Clay' }),
      ev({ ...oeiras, week: 21, surface: 'Clay' }),
      ev({ ...lisbon, week: 22, surface: 'Grass' }),
      ev({ ...oeiras, week: 23, surface: 'Grass' }),
    ]);
    expect(swings).toHaveLength(2);
    expect(swings[0].surfaces).toEqual(['Clay']);
    expect(swings[1].surfaces).toEqual(['Grass']);
  });

  it('labels regional US chains (US Midwest swing)', () => {
    const chicago = { country: 'United States', latitude: 41.8781, longitude: -87.6298 };
    const indianapolis = { country: 'United States', latitude: 39.7684, longitude: -86.158 };
    const columbus = { country: 'United States', latitude: 39.9612, longitude: -82.9988 };
    const swings = detectSwings([
      ev({ ...chicago, week: 30 }),
      ev({ ...indianapolis, week: 31 }),
      ev({ ...columbus, week: 32 }),
    ]);
    expect(swings[0].label).toBe('US Midwest swing');
  });

  it('falls back to plain US swing for coast-to-coast chains', () => {
    const swings = detectSwings([
      ev({ ...losAngeles, week: 30 }),
      ev({ ...newYork, week: 31 }),
    ]);
    expect(swings[0].label).toBe('US swing');
  });

  it('labels chains of country-less tournaments by city instead of blank', () => {
    const bengaluru = { country: null, latitude: 12.9768, longitude: 77.5901 };
    const swings = detectSwings([
      ev({ ...bengaluru, city: 'Bengaluru 2', week: 19 }),
      ev({ ...bengaluru, city: 'Bengaluru 3', week: 20 }),
    ]);
    expect(swings[0].label).toBe('Bengaluru swing');
  });

  it('disambiguates repeated labels with the start month', () => {
    const mexicoCity = { country: 'Mexico', latitude: 19.4326, longitude: -99.1332 };
    const swings = detectSwings([
      ev({ ...mexicoCity, week: 10, startDate: '2026-03-09' }),
      ev({ ...mexicoCity, week: 11, startDate: '2026-03-16' }),
      ev({ ...mexicoCity, week: 30, startDate: '2026-07-27' }),
      ev({ ...mexicoCity, week: 31, startDate: '2026-08-03' }),
    ]);
    expect(swings.map((s) => s.label)).toEqual(['Mexico swing (Mar)', 'Mexico swing (Jul)']);
  });
});

describe('formatTierMix', () => {
  it('orders by tier and counts duplicates', () => {
    expect(formatTierMix(['Challenger 50', 'Challenger 75', 'Challenger 50'])).toBe(
      'CH75 + 2× CH50'
    );
    expect(formatTierMix(['ATP 250', 'Grand Slam'])).toBe('GS + ATP250');
    expect(formatTierMix(['Challenger'])).toBe('CH');
  });
});

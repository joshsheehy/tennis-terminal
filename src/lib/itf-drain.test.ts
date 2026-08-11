import { describe, it, expect } from 'vitest';
import { itfExposure, itfNearby, itfNote } from './itf-drain';
import type { DepthEvent } from './depth';

const ev = (o: Partial<DepthEvent> & { editionId: string }): DepthEvent => ({
  slug: o.editionId,
  name: o.editionId,
  year: 2026,
  week: 20,
  level: 'Challenger 75',
  surface: 'Clay',
  indoor: false,
  latitude: 45,
  longitude: 5,
  ...o,
});

describe('itfExposure', () => {
  it('is high where a Challenger cut sits inside the ITF band', () => {
    expect(itfExposure('Challenger 50')).toBe('high');
    expect(itfExposure('Challenger 75')).toBe('high');
    expect(itfExposure('Challenger 80')).toBe('high');
  });

  it('is low where the cut sits above most of the ITF population', () => {
    expect(itfExposure('Challenger 100')).toBe('low');
    expect(itfExposure('Challenger 125')).toBe('low');
  });

  it('is none above the Challenger stack and at C175', () => {
    expect(itfExposure('Challenger 175')).toBe('none');
    expect(itfExposure('ATP 250')).toBe('none');
    expect(itfExposure('Grand Slam')).toBe('none');
  });

  it('is none for ITF itself', () => {
    expect(itfExposure('ITF M25')).toBe('none');
  });
});

describe('itfNearby', () => {
  const target = ev({ editionId: 'ch', level: 'Challenger 75' });

  it('counts only ITF events, not other Challengers', () => {
    const near = itfNearby(target, [
      target,
      ev({ editionId: 'a', level: 'ITF M25' }),
      ev({ editionId: 'b', level: 'ITF M15' }),
      ev({ editionId: 'c', level: 'Challenger 100' }),
    ]);
    expect(near.events).toBe(2);
    expect(near.places).toBe(48);
  });

  it('excludes ITF events outside the travel radius', () => {
    const near = itfNearby(target, [
      target,
      ev({ editionId: 'far', level: 'ITF M25', latitude: -35, longitude: 150 }),
    ]);
    expect(near.events).toBe(0);
  });

  it('never counts the target itself', () => {
    const itfTarget = ev({ editionId: 'x', level: 'ITF M25' });
    expect(itfNearby(itfTarget, [itfTarget]).events).toBe(0);
  });

  it('returns nothing when the target has no coordinates', () => {
    const noGeo = ev({ editionId: 'n', latitude: null, longitude: null });
    expect(itfNearby(noGeo, [noGeo, ev({ editionId: 'a', level: 'ITF M25' })]).events).toBe(0);
  });

  it('reports the target level exposure regardless of what is nearby', () => {
    const atp = ev({ editionId: 'atp', level: 'ATP 250' });
    expect(itfNearby(atp, [atp, ev({ editionId: 'a', level: 'ITF M25' })]).exposure).toBe('none');
  });
});

describe('itfNote', () => {
  it('says the pull is real at a low Challenger', () => {
    expect(itfNote({ events: 3, places: 72, exposure: 'high' })).toMatch(/same band as the cut/);
  });

  it('says the pull is small where the cut sits above the ITF band', () => {
    expect(itfNote({ events: 3, places: 72, exposure: 'low' })).toMatch(/pull is small/);
  });

  it('stays silent when there is nothing to say', () => {
    expect(itfNote({ events: 0, places: 0, exposure: 'high' })).toBeNull();
    expect(itfNote({ events: 5, places: 120, exposure: 'none' })).toBeNull();
  });

  it('pluralises', () => {
    expect(itfNote({ events: 1, places: 24, exposure: 'high' })).toContain('1 ITF event ');
    expect(itfNote({ events: 2, places: 48, exposure: 'high' })).toContain('2 ITF events ');
  });
});

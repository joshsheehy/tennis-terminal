import { describe, it, expect } from 'vitest';
import {
  tierGroup,
  tierChangeFactor,
  cohortBase,
  predictCut,
  supplyAdjustment,
  median,
  haversineKm,
  DEFAULT_BETAS,
  type CutObservation,
} from './cut-prediction';

const obs = (
  slug: string,
  year: number,
  week: number,
  cut: number,
  coords: [number, number] | null = null,
  level = 'Challenger 75'
): CutObservation => ({
  slug,
  year,
  week,
  group: 'challenger',
  level,
  latitude: coords?.[0] ?? null,
  longitude: coords?.[1] ?? null,
  cut,
});

const target = {
  slug: 'target',
  year: 2025,
  week: 10,
  group: 'challenger' as const,
  level: 'Challenger 75',
  latitude: 47,
  longitude: 7,
};

describe('tierGroup', () => {
  it('classifies levels and excludes ITF', () => {
    expect(tierGroup('Grand Slam Qualifying')).toBe('gs');
    expect(tierGroup('ATP 250')).toBe('tour');
    expect(tierGroup('Challenger 80')).toBe('challenger');
    expect(tierGroup('ITF M25')).toBeNull();
  });
});

describe('tierChangeFactor', () => {
  // Prior seasons: Challenger 75 cuts around 400, Challenger 125 around 200.
  const history: CutObservation[] = [];
  for (let i = 0; i < 10; i++) {
    history.push(obs(`c75-${i}`, 2023, i + 1, 390 + i * 2, null, 'Challenger 75'));
    history.push(obs(`c125-${i}`, 2023, i + 1, 195 + i * 2, null, 'Challenger 125'));
  }

  it('rescales when the tournament changed tier', () => {
    const up = tierChangeFactor(history, 'Challenger 125', 'Challenger 75', 2025);
    expect(up).toBeLessThan(0.7); // promoted → stronger field → shallower cut
    const down = tierChangeFactor(history, 'Challenger 75', 'Challenger 125', 2025);
    expect(down).toBeGreaterThan(1.5);
  });

  it('is neutral without a change or with thin data', () => {
    expect(tierChangeFactor(history, 'Challenger 75', 'Challenger 75', 2025)).toBe(1);
    expect(tierChangeFactor(history, 'Challenger 75', null, 2025)).toBe(1);
    expect(tierChangeFactor(history.slice(0, 4), 'Challenger 125', 'Challenger 75', 2025)).toBe(1);
  });

  it('only looks at prior seasons', () => {
    const futureOnly = history.map((o) => ({ ...o, year: 2026 }));
    expect(tierChangeFactor(futureOnly, 'Challenger 125', 'Challenger 75', 2025)).toBe(1);
  });
});

describe('predictCut', () => {
  it('blends the last two own cuts (singles main: 0.7/0.3)', () => {
    const p = predictCut(target, { lastYearCut: 300, yearBeforeCut: 200, lastYearLevel: 'Challenger 75' }, [], 'ms');
    expect(p?.method).toBe('trend');
    expect(p?.cut).toBe(Math.round(0.7 * 300 + 0.3 * 200));
    expect(p!.low).toBeLessThan(p!.cut);
    expect(p!.high).toBeGreaterThan(p!.cut);
  });

  it('uses last year alone when the year before is missing', () => {
    const p = predictCut(target, { lastYearCut: 300, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, [], 'ms');
    expect(p?.cut).toBe(300);
  });

  it('applies the tier-change factor to the blended base', () => {
    const history: CutObservation[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(obs(`c75-${i}`, 2023, i + 1, 400, null, 'Challenger 75'));
      history.push(obs(`c125-${i}`, 2023, i + 1, 200, null, 'Challenger 125'));
    }
    const promoted = { ...target, level: 'Challenger 125' };
    const p = predictCut(promoted, { lastYearCut: 400, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, history, 'ms');
    expect(p?.tierFactor).toBeCloseTo(0.55, 2); // clamped floor of 200/400
    expect(p?.cut).toBe(Math.round(400 * p!.tierFactor));
  });

  it('falls back to a wider cohort prediction without own history', () => {
    const rows = [
      obs('a', 2024, 9, 200, [46, 6]),
      obs('b', 2024, 10, 260, [47, 8]),
      obs('c', 2024, 11, 320, [48, 9]),
    ];
    const p = predictCut(target, { lastYearCut: null, yearBeforeCut: null, lastYearLevel: null }, rows, 'ms');
    expect(p?.method).toBe('cohort');
    expect(p?.cut).toBe(260);
    const trend = predictCut(target, { lastYearCut: 260, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, rows, 'ms')!;
    expect((p!.high - p!.low) / p!.cut).toBeGreaterThan((trend.high - trend.low) / trend.cut);
  });

  it('returns null with neither history nor cohort', () => {
    expect(predictCut(target, { lastYearCut: null, yearBeforeCut: null, lastYearLevel: null }, [], 'ms')).toBeNull();
  });
});

describe('cohortBase', () => {
  it('uses last season same-week same-group medians', () => {
    const rows = [
      obs('a', 2024, 9, 200, [46, 6]),
      obs('b', 2024, 10, 260, [47, 8]),
      obs('c', 2024, 11, 320, [48, 9]),
    ];
    expect(cohortBase(target, rows)).toBe(260);
  });

  it('returns null when the cohort is too thin', () => {
    expect(cohortBase({ ...target, latitude: null, longitude: null }, [obs('a', 2024, 10, 200)])).toBeNull();
  });
});

describe('supplyAdjustment (fitted to zero, kept measurable)', () => {
  it('is neutral at the fitted default betas', () => {
    expect(supplyAdjustment({ sameWeekRatio: 1.8, runupRatio: 1.5 }, DEFAULT_BETAS)).toBe(1);
  });

  it('responds when given non-zero betas, with clamping', () => {
    const betas = { supply: 0.3, runup: 0.1 };
    expect(supplyAdjustment({ sameWeekRatio: 1.5, runupRatio: null }, betas)).toBeGreaterThan(1);
    expect(supplyAdjustment({ sameWeekRatio: 10, runupRatio: null }, betas)).toBe(
      supplyAdjustment({ sameWeekRatio: 2, runupRatio: null }, betas)
    );
  });
});

describe('helpers', () => {
  it('median of even/odd sets', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('haversine sanity: Paris-London ~344km', () => {
    expect(haversineKm(48.8566, 2.3522, 51.5074, -0.1278)).toBeGreaterThan(330);
    expect(haversineKm(48.8566, 2.3522, 51.5074, -0.1278)).toBeLessThan(360);
  });
});

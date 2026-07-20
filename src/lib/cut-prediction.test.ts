import { describe, it, expect } from 'vitest';
import {
  tierGroup,
  tierChangeFactor,
  cohortBase,
  liveSeasonDrift,
  regionalSwingDrift,
  predictCut,
  supplyAdjustment,
  median,
  haversineKm,
  DEFAULT_BETAS,
  DRIFT_BETA,
  REGIONAL_SWING_BETA,
  SHRINK_ALPHA,
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

  it('winsorizes a freak last year against own prior history (Newport 2025 case)', () => {
    // Own history 486/616/286 (median 486), then a 1314 outlier year caused
    // by regional field-splitting. The blend must not trust 1314 raw.
    const p = predictCut(
      { ...target, year: 2026 },
      { lastYearCut: 1314, yearBeforeCut: 286, lastYearLevel: 'Challenger 75', priorCuts: [486, 616, 286] },
      [],
      'qs'
    );
    const clampedLast = 486 * 1.75; // 850.5
    expect(p?.cut).toBe(Math.round(0.65 * clampedLast + 0.35 * 286));
    // and a normal last year is untouched
    const normal = predictCut(
      { ...target, year: 2026 },
      { lastYearCut: 500, yearBeforeCut: 480, lastYearLevel: 'Challenger 75', priorCuts: [486, 616, 286] },
      [],
      'qs'
    );
    expect(normal?.cut).toBe(Math.round(0.65 * 500 + 0.35 * 480));
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

describe('liveSeasonDrift', () => {
  // 10 events completed this season (weeks 1-9), each 20% deeper than its own
  // cut last year -> drift ratio 1.2 for a week-10 target.
  const rows: CutObservation[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push(obs(`e${i}`, 2024, i + 1, 500));
    rows.push(obs(`e${i}`, 2025, i + 1, 600));
  }

  it('measures the median year-over-year ratio of completed weeks', () => {
    expect(liveSeasonDrift(rows, target)).toBeCloseTo(1.2, 5);
  });

  it('ignores events at or after the target week and other groups', () => {
    const later = [...rows, obs('future', 2025, 11, 5000), obs('future', 2024, 11, 100)];
    expect(liveSeasonDrift(later, target)).toBeCloseTo(1.2, 5);
  });

  it('is neutral with thin support and clamps extremes', () => {
    expect(liveSeasonDrift(rows.slice(0, 8), target)).toBe(1); // 4 pairs < min 8
    const wild = rows.map((o) => (o.year === 2025 ? { ...o, cut: o.cut * 10 } : o));
    expect(liveSeasonDrift(wild, target)).toBe(1.6);
  });

  it('feeds predictCut as a damped multiplier before shrinkage', () => {
    const p = predictCut(target, { lastYearCut: 400, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, rows, 'ms');
    // drift = 1.2^0.25 on the 400 base; cohort = the three 2024 events within
    // ±2 weeks of week 10 (weeks 8/9/10, all cut 500).
    const drifted = 400 * 1.2 ** DRIFT_BETA;
    const expected = Math.round(SHRINK_ALPHA.ms * drifted + (1 - SHRINK_ALPHA.ms) * 500);
    expect(p?.cut).toBe(expected);
    expect(p!.cut).toBeGreaterThan(400); // deeper season pulls it deeper
  });
});

describe('regionalSwingDrift', () => {
  const regionalTarget = { ...target, year: 2025, week: 10, latitude: 47, longitude: 7 };
  const rows: CutObservation[] = [];
  for (let i = 0; i < 3; i++) {
    rows.push(obs(`local${i}`, 2024, 7 + i, 400, [47 + i * 0.2, 7 + i * 0.2]));
    rows.push(obs(`local${i}`, 2025, 7 + i, 600, [47 + i * 0.2, 7 + i * 0.2]));
  }
  rows.push(obs('far', 2024, 9, 100, [-30, -60]));
  rows.push(obs('far', 2025, 9, 1000, [-30, -60]));

  it('measures recent same-region year-over-year cut movement', () => {
    expect(regionalSwingDrift(rows, regionalTarget)).toBeCloseTo(1.5, 5);
  });

  it('is neutral without coordinates or enough local pairs', () => {
    expect(regionalSwingDrift(rows, { ...regionalTarget, latitude: null })).toBe(1);
    expect(regionalSwingDrift(rows.slice(0, 4), regionalTarget)).toBe(1);
  });

  it('feeds predictCut as a damped multiplier before shrinkage', () => {
    const p = predictCut(regionalTarget, { lastYearCut: 400, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, rows, 'ms');
    const drifted = 400 * 1.5 ** REGIONAL_SWING_BETA;
    const expected = Math.round(SHRINK_ALPHA.ms * drifted + (1 - SHRINK_ALPHA.ms) * 400);
    expect(p?.cut).toBe(expected);
  });
});

describe('cohort shrinkage', () => {
  it('pulls the trend estimate toward the cohort median', () => {
    // Last season cohort around week 10: three events with median cut 600.
    const rows = [
      obs('a', 2024, 9, 500, [46, 6]),
      obs('b', 2024, 10, 600, [47, 8]),
      obs('c', 2024, 11, 700, [48, 9]),
    ];
    const p = predictCut(target, { lastYearCut: 300, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, rows, 'ms');
    const alpha = SHRINK_ALPHA.ms;
    expect(p?.cut).toBe(Math.round(alpha * 300 + (1 - alpha) * 600));
  });

  it('leaves the estimate alone when no cohort forms (slam case)', () => {
    const p = predictCut(target, { lastYearCut: 300, yearBeforeCut: null, lastYearLevel: 'Challenger 75' }, [], 'ms');
    expect(p?.cut).toBe(300);
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

describe('regional waterfall signals', () => {
  it('measures year-over-year committed-player mass around a venue', async () => {
    const { supplySignalsFor } = await import('./cut-prediction-data');
    const ev = (year: number, week: number, lat: number, lon: number, weight: number) => ({ year, week, lat, lon, weight });
    const events = [
      // last year: one nearby challenger; this year: same + a new ATP next week
      ev(2024, 10, 47, 7, 1),
      ev(2025, 10, 47, 7, 1),
      ev(2025, 11, 47.5, 7.5, 2),
      // far away, must not count
      ev(2025, 10, -30, -60, 3),
    ];
    const s = supplySignalsFor(events, 2025, 10, 47, 7);
    expect(s.sameWeekRatio).toBeCloseTo((1 + 2 + 1) / (1 + 1), 5);
    const none = supplySignalsFor(events, 2025, 10, null, null);
    expect(none.sameWeekRatio).toBeNull();
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

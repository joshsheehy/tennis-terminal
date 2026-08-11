import { describe, it, expect } from 'vitest';
import {
  isScorableLevel,
  buildCohorts,
  strengthScore,
  strengthBand,
  MIN_COHORT,
} from './field-strength';

const cohortOf = (n: number, start = 100, step = 10) =>
  Array.from({ length: n }, (_, i) => start + i * step);

describe('isScorableLevel', () => {
  it('includes Challenger, ATP and Grand Slam', () => {
    expect(isScorableLevel('Challenger 100')).toBe(true);
    expect(isScorableLevel('ATP 250')).toBe(true);
    expect(isScorableLevel('Grand Slam')).toBe(true);
  });

  it('excludes ITF, which has no cut data collected', () => {
    expect(isScorableLevel('ITF M25')).toBe(false);
    expect(isScorableLevel('ITF World Tennis Tour')).toBe(false);
  });
});

describe('buildCohorts', () => {
  it('groups by exact level and sorts', () => {
    const cohorts = buildCohorts([
      { level: 'Challenger 100', cut: 300 },
      { level: 'Challenger 100', cut: 150 },
      { level: 'ATP 250', cut: 90 },
    ]);
    expect(cohorts.get('Challenger 100')).toEqual([150, 300]);
    expect(cohorts.get('ATP 250')).toEqual([90]);
  });

  it('never mixes levels, so a C75 is not scored against ATP cuts', () => {
    const cohorts = buildCohorts([
      { level: 'Challenger 75', cut: 350 },
      { level: 'ATP 500', cut: 60 },
    ]);
    expect(cohorts.get('Challenger 75')).toEqual([350]);
    expect(cohorts.has('ATP 500')).toBe(true);
    expect(cohorts.get('Challenger 75')).not.toContain(60);
  });

  it('drops ITF rows and unusable cuts', () => {
    const cohorts = buildCohorts([
      { level: 'ITF M25', cut: 500 },
      { level: 'Challenger 100', cut: null },
      { level: 'Challenger 100', cut: 1 },
      { level: 'Challenger 100', cut: 200 },
    ]);
    expect(cohorts.has('ITF M25')).toBe(false);
    expect(cohorts.get('Challenger 100')).toEqual([200]);
  });
});

describe('strengthScore', () => {
  const cohort = cohortOf(20); // 100,110,...,290

  it('scores a strong field (low cut) near 100', () => {
    expect(strengthScore(100, cohort)).toBeGreaterThan(90);
  });

  it('scores a weak field (high cut) near 0', () => {
    expect(strengthScore(290, cohort)).toBeLessThan(10);
  });

  it('scores the middle of the cohort near 50', () => {
    expect(strengthScore(195, cohort)).toBe(50);
  });

  it('is monotonic: a lower cut always scores at least as high', () => {
    for (let c = 100; c < 290; c += 10) {
      expect(strengthScore(c, cohort)!).toBeGreaterThanOrEqual(
        strengthScore(c + 10, cohort)!
      );
    }
  });

  it('keeps an all-identical cohort at 50 rather than collapsing to 0 or 100', () => {
    const flat = Array.from({ length: 10 }, () => 200);
    expect(strengthScore(200, flat)).toBe(50);
  });

  it('returns null below the minimum cohort size instead of a coarse guess', () => {
    expect(strengthScore(150, cohortOf(MIN_COHORT - 1))).toBeNull();
    expect(strengthScore(150, cohortOf(MIN_COHORT))).not.toBeNull();
  });

  it('makes different levels comparable — a typical edition scores ~50 in each', () => {
    const challenger = cohortOf(20, 200, 10); // 200..390
    const atp = cohortOf(20, 50, 5); // 50..145
    expect(strengthScore(295, challenger)).toBe(50);
    expect(strengthScore(97.5, atp)).toBe(50);
  });
});

describe('strengthBand', () => {
  it('bands movement in score points', () => {
    expect(strengthBand(20)).toBe('much-stronger');
    expect(strengthBand(8)).toBe('stronger');
    expect(strengthBand(0)).toBe('similar');
    expect(strengthBand(-8)).toBe('weaker');
    expect(strengthBand(-20)).toBe('much-weaker');
  });

  it('treats small movement as noise', () => {
    expect(strengthBand(4)).toBe('similar');
    expect(strengthBand(-4)).toBe('similar');
  });

  it('is symmetric about zero', () => {
    for (const d of [5, 15, 30]) {
      expect(strengthBand(d)).toBe(
        { 5: 'stronger', 15: 'much-stronger', 30: 'much-stronger' }[d]
      );
      expect(strengthBand(-d)).toBe(
        { 5: 'weaker', 15: 'much-weaker', 30: 'much-weaker' }[d]
      );
    }
  });
});

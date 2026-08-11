import { describe, it, expect } from 'vitest';
import {
  isScorableLevel,
  buildCohorts,
  strengthScore,
  strengthBand,
  MIN_COHORT,
  BAND_EDGE,
  BAND_LABEL,
  BAND_COLOR,
  scoreMeaning,
  entryMeaning,
  projectionTooUncertain,
  MAX_USABLE_RANGE,
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
    expect(strengthBand(40)).toBe('much-stronger');
    expect(strengthBand(18)).toBe('stronger');
    expect(strengthBand(0)).toBe('similar');
    expect(strengthBand(-18)).toBe('weaker');
    expect(strengthBand(-40)).toBe('much-weaker');
  });

  // Calibrated against production: the middle half of events moves between -19
  // and +13 points, so a move of 8 is an ordinary season, not a real change.
  // Edges of 5/15 put 54% of events in a "Much" band and only 18% in "About the
  // same", which makes the labels say nothing.
  it('treats ordinary year-to-year drift as unchanged', () => {
    for (const d of [-11, -8, -4, 0, 4, 8, 11]) {
      expect(strengthBand(d)).toBe('similar');
    }
  });

  it('reserves the extreme bands for genuinely large moves', () => {
    expect(strengthBand(BAND_EDGE.notable - 1)).toBe('similar');
    expect(strengthBand(BAND_EDGE.notable)).toBe('stronger');
    expect(strengthBand(BAND_EDGE.extreme - 1)).toBe('stronger');
    expect(strengthBand(BAND_EDGE.extreme)).toBe('much-stronger');
  });

  it('is symmetric about zero', () => {
    for (const d of [12, 20, 30, 50]) {
      expect(strengthBand(-d)).toBe(strengthBand(d).replace('stronger', 'weaker'));
    }
  });
});

describe('plain-language translation', () => {
  it('reads a score as the percentile it actually is', () => {
    expect(scoreMeaning(52, 'Challenger 100')).toBe(
      'stronger than 52% of Challenger 100 editions on record'
    );
  });

  it('avoids a silly "stronger than 97%" phrasing at the extremes', () => {
    expect(scoreMeaning(97, 'ATP 250')).toMatch(/almost every ATP 250/);
    expect(scoreMeaning(3, 'ATP 250')).toMatch(/weaker than almost every/);
  });

  it('gives a beginner something to act on across the range', () => {
    expect(entryMeaning(90)).toMatch(/hard/);
    expect(entryMeaning(50)).toMatch(/normal/);
    expect(entryMeaning(10)).toMatch(/easy/);
  });

  // A weaker field is the OPPORTUNITY for a player: easier to get into. Colour
  // has to track that, not a good/bad reading of field quality.
  it('labels bands from the player side, not the field side', () => {
    expect(BAND_LABEL['much-weaker']).toMatch(/easier/i);
    expect(BAND_LABEL['much-stronger']).toMatch(/tougher/i);
  });

  it('paints the easier event green and the tougher one red', () => {
    expect(BAND_COLOR['much-weaker']).toBe('#0f6b3a');
    expect(BAND_COLOR.weaker).toBe('#1a7f47');
    expect(BAND_COLOR['much-stronger']).toBe('#b3261e');
    expect(BAND_COLOR.stronger).toBe('#c2691e');
  });
});

describe('projectionTooUncertain', () => {
  // Real case from production: a doubles projection read "68 -> ~30 (5-97)",
  // which covers almost the whole scale, yet the point estimate still drove a
  // confident "Much easier to enter" in green.
  it('rejects a range covering most of the scale', () => {
    expect(projectionTooUncertain(5, 97)).toBe(true);
  });

  it('accepts a range narrow enough to mean something', () => {
    expect(projectionTooUncertain(28, 55)).toBe(false);
  });

  it('is false for measured rows, which carry no bounds', () => {
    expect(projectionTooUncertain(null, null)).toBe(false);
    expect(projectionTooUncertain(40, null)).toBe(false);
  });

  it('cuts over exactly at the threshold', () => {
    expect(projectionTooUncertain(10, 10 + MAX_USABLE_RANGE)).toBe(false);
    expect(projectionTooUncertain(10, 10 + MAX_USABLE_RANGE + 1)).toBe(true);
  });
});

describe('ITF exclusion', () => {
  it('keeps ITF out, so no strength block is ever rendered for one', () => {
    for (const l of ['ITF M15', 'ITF M25', 'ITF World Tennis Tour', 'ITF A']) {
      expect(isScorableLevel(l)).toBe(false);
    }
  });
});

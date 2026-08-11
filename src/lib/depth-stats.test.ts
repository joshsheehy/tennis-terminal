import { describe, it, expect } from 'vitest';
import {
  mean,
  sd,
  median,
  rankAverage,
  pearson,
  spearman,
  olsThroughOrigin,
  mae,
  concordantPairs,
} from './depth-stats';

describe('summary statistics', () => {
  it('computes mean, sd and median', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('returns NaN rather than 0 for empty input', () => {
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(Number.isNaN(sd([1]))).toBe(true);
  });
});

describe('rankAverage', () => {
  it('averages tied ranks', () => {
    // Depth ties constantly — two events alone at their level both score 14.
    expect(rankAverage([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('ranks ascending', () => {
    expect(rankAverage([5, 1, 3])).toEqual([3, 1, 2]);
  });
});

describe('correlation', () => {
  it('finds perfect positive and negative correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 9);
  });

  it('spearman survives a monotone but non-linear relationship', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 9);
  });

  it('returns NaN when a series has no variance', () => {
    expect(Number.isNaN(pearson([1, 1, 1], [1, 2, 3]))).toBe(true);
  });
});

describe('olsThroughOrigin', () => {
  it('recovers a known slope', () => {
    const xs = [-3, -1, 0, 2, 5];
    const ys = xs.map((x) => 0.04 * x);
    expect(olsThroughOrigin(xs, ys)).toBeCloseTo(0.04, 9);
  });

  it('returns 0 when every x is 0, so a stable calendar cannot move the fit', () => {
    expect(olsThroughOrigin([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('mae', () => {
  it('averages absolute error', () => {
    expect(mae([-2, 4, -6])).toBe(4);
  });
});

describe('concordantPairs', () => {
  it('counts agreeing orderings and skips ties', () => {
    expect(concordantPairs([1, 2, 3], [10, 20, 30])).toEqual({ agree: 3, total: 3 });
    expect(concordantPairs([1, 2, 3], [30, 20, 10])).toEqual({ agree: 0, total: 3 });
    expect(concordantPairs([1, 1, 3], [10, 20, 30])).toEqual({ agree: 2, total: 2 });
  });
});

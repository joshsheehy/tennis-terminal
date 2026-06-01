import { describe, it, expect } from 'vitest';
import { checkRankAnomaly, minPlausibleRank } from './cutoff-anomaly';

describe('checkRankAnomaly', () => {
  it('rejects a single-digit cut on ATP 1000 singles main (Paris parser bug)', () => {
    const result = checkRankAnomaly(12, 'ATP 1000', 'singles', 'main');
    expect(result).not.toBeNull();
    expect(result?.rejectedRank).toBe(12);
    expect(result?.minimumExpected).toBe(25);
  });

  it('rejects a single-digit cut on ATP 500 singles main (Tokyo parser bug)', () => {
    const result = checkRankAnomaly(7, 'ATP 500', 'singles', 'main');
    expect(result).not.toBeNull();
    expect(result?.rejectedRank).toBe(7);
  });

  it('accepts a low-but-real Tokyo ATP 500 cut of 46', () => {
    expect(checkRankAnomaly(46, 'ATP 500', 'singles', 'main')).toBeNull();
  });

  it('accepts a plausible ATP 1000 singles cut of 41', () => {
    expect(checkRankAnomaly(41, 'ATP 1000', 'singles', 'main')).toBeNull();
  });

  it('accepts an ATP 250 cut just above the lower bound', () => {
    expect(checkRankAnomaly(15, 'ATP 250', 'singles', 'main')).toBeNull();
  });

  it('rejects a cut of 5 on Challenger singles main', () => {
    const result = checkRankAnomaly(5, 'Challenger 100', 'singles', 'main');
    expect(result).not.toBeNull();
  });

  it('passes through when no rank was parsed', () => {
    expect(checkRankAnomaly(null, 'ATP 1000', 'singles', 'main')).toBeNull();
  });

  it('skips validation when level is unknown', () => {
    expect(checkRankAnomaly(2, null, 'singles', 'main')).toBeNull();
  });

  it('uses a higher qualifying threshold regardless of level', () => {
    expect(minPlausibleRank('ATP 250', 'singles', 'qualifying')).toBe(30);
    expect(checkRankAnomaly(25, 'ATP 500', 'singles', 'qualifying')).not.toBeNull();
    expect(checkRankAnomaly(75, 'ATP 1000', 'singles', 'qualifying')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  clusterSplits,
  splitReason,
  suggestCanonical,
  type SplitRecord,
} from './tournament-splits';

const record = (
  slug: string,
  editions: Array<[number, number, string?]>,
  cutoffCount = 0
): SplitRecord => ({
  tournamentId: slug,
  slug,
  name: slug,
  city: 'Somewhere',
  country: 'X',
  editions: editions.map(([year, week, level]) => ({ year, week, level: level ?? 'Challenger 75' })),
  cutoffCount,
});

describe('splitReason', () => {
  it('flags two records holding the same week of the same year', () => {
    expect(splitReason(record('a', [[2026, 39]]), record('b', [[2026, 39]]))).toBe(
      'same-week-same-year'
    );
  });

  it('flags a rename: the same week, and years that never overlap', () => {
    const before = record('moselle-open', [[2022, 38], [2023, 38], [2024, 38], [2025, 38]]);
    const after = record('metz', [[2026, 38]]);
    expect(splitReason(before, after)).toBe('renamed-same-week');
  });

  // The failure that made a city-only check unusable: it called these one event
  // and would have merged a Grand Slam into a Masters.
  it('leaves two different events in one city alone', () => {
    const rolandGarros = record('roland-garros', [[2025, 22], [2026, 22]], 3);
    const parisMasters = record('paris-masters', [[2025, 44], [2026, 44]], 15);
    expect(splitReason(rolandGarros, parisMasters)).toBeNull();
  });

  it('leaves a numbered series alone, even in consecutive weeks', () => {
    const one = { ...record('oeiras-1', [[2025, 20], [2026, 20]]), name: 'Oeiras 1' };
    const two = { ...record('oeiras-2', [[2025, 21], [2026, 21]]), name: 'Oeiras 2' };
    const four = { ...record('oeiras-4', [[2025, 23], [2026, 23]]), name: 'Oeiras 4' };
    expect(splitReason(one, two)).toBeNull();
    expect(splitReason(one, four)).toBeNull();
  });

  // The number wins even when the weeks coincide exactly, which they do when a
  // series shifts and two of its events land on the same week in the data.
  it('leaves a numbered series alone when their weeks collide', () => {
    const one = { ...record('abidjan-1', [[2026, 17]]), name: 'Abidjan 1' };
    const two = { ...record('abidjan-2', [[2026, 17]]), name: 'Abidjan 2' };
    expect(splitReason(one, two)).toBeNull();
  });

  it('still matches a genuine duplicate whose name happens to end in a number', () => {
    const a = { ...record('oeiras-2', [[2026, 21]]), name: 'Oeiras 2' };
    const b = { ...record('oeiras-2-dup', [[2026, 21]]), name: 'Oeiras 2' };
    expect(splitReason(a, b)).toBe('same-week-same-year');
  });

  it('never matches across levels, whatever the weeks do', () => {
    const challenger = record('madrid-challenger', [[2026, 18, 'Challenger 100']]);
    const masters = record('mutua-madrid', [[2026, 18, 'ATP Masters 1000']]);
    expect(splitReason(challenger, masters)).toBeNull();
  });

  it('requires the exact week within a year, since series run back to back', () => {
    expect(splitReason(record('a', [[2026, 39]]), record('b', [[2026, 40]]))).toBeNull();
    expect(splitReason(record('a', [[2026, 39]]), record('b', [[2026, 39]]))).toBe(
      'same-week-same-year'
    );
  });

  it('allows a week of drift across a rename, where the calendar moved', () => {
    const before = record('moselle-open', [[2024, 44], [2025, 45]]);
    const after = record('metz', [[2026, 43]]);
    expect(splitReason(before, after)).toBe('renamed-same-week');
  });

  it('says nothing about a record with no editions', () => {
    expect(splitReason(record('a', []), record('b', [[2026, 39]]))).toBeNull();
  });
});

describe('clusterSplits', () => {
  it('gathers a three-way split through the record that links them', () => {
    // Mouilleron-le-Captif: one record carries every year, two split the latest.
    const all = record('open-de-vendee', [[2022, 39], [2024, 39], [2025, 39], [2026, 39]], 9);
    const renamed = record('open-de-vendee-mouilleron-le-captif', [[2026, 39]], 3);
    const city = record('mouilleron-le-captif', [[2026, 39]], 0);
    const [cluster] = clusterSplits([all, renamed, city]);
    expect(cluster.records.map((r) => r.slug).sort()).toEqual(
      ['mouilleron-le-captif', 'open-de-vendee', 'open-de-vendee-mouilleron-le-captif'].sort()
    );
  });

  it('returns nothing when every record stands alone', () => {
    expect(clusterSplits([record('a', [[2026, 10]]), record('b', [[2026, 30]])])).toEqual([]);
  });

  it('does not put a record in two clusters', () => {
    const clusters = clusterSplits([
      record('a', [[2026, 10]]),
      record('b', [[2026, 10]]),
      record('c', [[2026, 30]]),
      record('d', [[2026, 30]]),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.flatMap((c) => c.records.map((r) => r.slug))).toHaveLength(4);
  });
});

describe('suggestCanonical', () => {
  it('keeps the record holding the most cut history', () => {
    const kept = suggestCanonical([
      record('bare-city', [[2026, 39]], 0),
      record('open-de-vendee', [[2025, 39], [2026, 39]], 9),
    ]);
    expect(kept.slug).toBe('open-de-vendee');
  });

  it('breaks a tie on coverage, then on the more specific slug', () => {
    expect(
      suggestCanonical([record('metz', [[2026, 38]], 0), record('moselle-open-metz', [[2026, 38]], 0)]).slug
    ).toBe('moselle-open-metz');
  });
});

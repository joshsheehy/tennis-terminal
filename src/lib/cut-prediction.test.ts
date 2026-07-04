import { describe, it, expect } from 'vitest';
import {
  tierGroup,
  driftFactor,
  cohortBase,
  predictCut,
  median,
  haversineKm,
  type CutObservation,
} from './cut-prediction';

const obs = (
  slug: string,
  year: number,
  week: number,
  cut: number,
  coords: [number, number] | null = null
): CutObservation => ({
  slug,
  year,
  week,
  group: 'challenger',
  latitude: coords?.[0] ?? null,
  longitude: coords?.[1] ?? null,
  cut,
});

// Six European challengers whose cuts all deepened ~20% from 2024 to 2025,
// published in weeks 1-5 of 2025.
function driftingMarket(): CutObservation[] {
  const rows: CutObservation[] = [];
  for (let i = 0; i < 6; i++) {
    const coords: [number, number] = [45 + i, 5 + i];
    rows.push(obs(`eu-${i}`, 2024, i + 1, 250, coords));
    rows.push(obs(`eu-${i}`, 2025, i + 1, 300, coords));
  }
  return rows;
}

describe('tierGroup', () => {
  it('classifies levels and excludes ITF', () => {
    expect(tierGroup('Grand Slam Qualifying')).toBe('gs');
    expect(tierGroup('ATP 250')).toBe('tour');
    expect(tierGroup('Challenger 80')).toBe('challenger');
    expect(tierGroup('ITF M25')).toBeNull();
  });
});

describe('driftFactor', () => {
  const target = { slug: 'target', year: 2025, week: 10, group: 'challenger' as const, latitude: 47, longitude: 7 };

  it('finds the market-wide ratio from year-over-year pairs', () => {
    const { drift, comparators } = driftFactor(target, driftingMarket(), 10);
    expect(drift).toBeCloseTo(1.2, 5);
    expect(comparators).toBe(6);
  });

  it('is strictly walk-forward: cuts at or after the as-of week are unseen', () => {
    const { comparators } = driftFactor(target, driftingMarket(), 2);
    // Only the week-1 pair precedes as-of week 2 — below the minimum, so no drift.
    expect(comparators).toBe(0);
  });

  it('prefers geographic neighbours when enough exist', () => {
    const rows = driftingMarket();
    // Five far-away events that CRASHED — a regional pool of 6 nearby should win.
    for (let i = 0; i < 5; i++) {
      rows.push(obs(`far-${i}`, 2024, i + 1, 300, [-30, -60]));
      rows.push(obs(`far-${i}`, 2025, i + 1, 150, [-30, -60]));
    }
    const { drift } = driftFactor(target, rows, 10);
    expect(drift).toBeCloseTo(1.2, 5);
  });

  it('returns neutral drift with too few comparators', () => {
    const { drift, comparators } = driftFactor(target, driftingMarket().slice(0, 4), 10);
    expect(drift).toBe(1);
    expect(comparators).toBe(0);
  });
});

describe('cohortBase', () => {
  it('uses last season same-week same-group medians', () => {
    const rows = [
      obs('a', 2024, 9, 200, [46, 6]),
      obs('b', 2024, 10, 260, [47, 8]),
      obs('c', 2024, 11, 320, [48, 9]),
    ];
    const base = cohortBase(
      { slug: 'new-event', year: 2025, week: 10, group: 'challenger', latitude: 47, longitude: 7 },
      rows
    );
    expect(base).toBe(260);
  });

  it('returns null when the cohort is too thin', () => {
    const base = cohortBase(
      { slug: 'new-event', year: 2025, week: 10, group: 'challenger', latitude: null, longitude: null },
      [obs('a', 2024, 10, 200)]
    );
    expect(base).toBeNull();
  });
});

describe('predictCut', () => {
  const target = { slug: 'target', year: 2025, week: 10, group: 'challenger' as const, latitude: 47, longitude: 7 };

  it('scales the own last-year cut by market drift', () => {
    const p = predictCut(target, 250, driftingMarket(), 10);
    expect(p?.method).toBe('trend');
    expect(p?.cut).toBe(300); // 250 × 1.2
    expect(p!.low).toBeLessThan(300);
    expect(p!.high).toBeGreaterThan(300);
  });

  it('falls back to a wider cohort prediction without own history', () => {
    const rows = driftingMarket();
    const p = predictCut({ ...target, week: 3 }, null, rows, 10);
    expect(p?.method).toBe('cohort');
    // Cohort band is wider than trend band.
    const trend = predictCut(target, p!.cut, rows, 10)!;
    expect((p!.high - p!.low) / p!.cut).toBeGreaterThan((trend.high - trend.low) / trend.cut);
  });

  it('returns null with neither history nor cohort', () => {
    expect(predictCut(target, null, [], 10)).toBeNull();
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

import { describe, expect, it } from 'vitest';
import { SLAM_CUTS, SLAM_SLUGS } from './slam-cuts';

const MAIN_SLUGS = new Set(Object.values(SLAM_SLUGS).map((s) => s.main));
const QUALI_SLUGS = new Set(Object.values(SLAM_SLUGS).map((s) => s.qualifying));

describe('SLAM_CUTS dataset', () => {
  it('has one row per (slug, year, event, draw)', () => {
    const keys = SLAM_CUTS.map((r) => `${r.slug}|${r.year}|${r.eventType}|${r.drawType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts each draw on the right tournament entry', () => {
    for (const r of SLAM_CUTS) {
      if (r.drawType === 'qualifying') {
        expect(QUALI_SLUGS.has(r.slug), r.slug).toBe(true);
        expect(r.eventType).toBe('singles');
      } else {
        expect(MAIN_SLUGS.has(r.slug), r.slug).toBe(true);
      }
    }
  });

  it('keeps every cut inside the range a Slam draw can produce', () => {
    for (const r of SLAM_CUTS) {
      const [min, max] =
        r.drawType === 'qualifying' ? [190, 280] : r.eventType === 'doubles' ? [100, 200] : [90, 115];
      expect(r.cut, `${r.slug} ${r.year} ${r.eventType}/${r.drawType}`).toBeGreaterThanOrEqual(min);
      expect(r.cut, `${r.slug} ${r.year} ${r.eventType}/${r.drawType}`).toBeLessThanOrEqual(max);
    }
  });

  it('cites an https source for every number', () => {
    for (const r of SLAM_CUTS) expect(r.source).toMatch(/^https:\/\//);
  });

  it('covers all three draws at every Slam for 2023-2025', () => {
    for (const year of [2023, 2024, 2025]) {
      for (const slugs of Object.values(SLAM_SLUGS)) {
        const rows = SLAM_CUTS.filter((r) => r.year === year && (r.slug === slugs.main || r.slug === slugs.qualifying));
        expect(rows.map((r) => `${r.eventType}/${r.drawType}`).sort()).toEqual([
          'doubles/main',
          'singles/main',
          'singles/qualifying',
        ]);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { SURFACE_OVERRIDES } from './surface-overrides';

describe('SURFACE_OVERRIDES', () => {
  it('has one entry per slug, each with a reason', () => {
    const slugs = SURFACE_OVERRIDES.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const o of SURFACE_OVERRIDES) expect(o.reason.length).toBeGreaterThan(20);
  });

  it('never marks a clay or grass court as indoor', () => {
    for (const o of SURFACE_OVERRIDES) {
      if (o.surface === 'Clay' || o.surface === 'Grass') expect(o.indoor).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeCategories, parseSelection } from './subscribers';

describe('normalizeCategories', () => {
  it('keeps valid tours and drops junk', () => {
    expect(normalizeCategories(['atp', 'grandslam', 'bogus'])).toEqual(['atp', 'grandslam']);
  });
  it('falls back to a default when nothing valid is sent', () => {
    expect(normalizeCategories([])).toEqual(['atp', 'challenger']);
    expect(normalizeCategories(['doubles'])).toEqual(['atp', 'challenger']);
  });
});

describe('parseSelection', () => {
  it('splits the doubles pseudo-value out of the category list', () => {
    const { categories, includeDoubles } = parseSelection(['grandslam', 'atp', 'doubles']);
    expect(categories).toEqual(['grandslam', 'atp']);
    expect(includeDoubles).toBe(true);
  });

  it('leaves doubles off when not selected', () => {
    const { categories, includeDoubles } = parseSelection(['challenger']);
    expect(categories).toEqual(['challenger']);
    expect(includeDoubles).toBe(false);
  });

  it('honours an explicit doubles boolean flag', () => {
    expect(parseSelection(['atp'], true).includeDoubles).toBe(true);
    expect(parseSelection(['atp'], false).includeDoubles).toBe(false);
  });
});

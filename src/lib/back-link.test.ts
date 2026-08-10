import { describe, it, expect } from 'vitest';
import { backLinkFor } from './back-link';
import { CURRENT_SEASON } from './seasons';

describe('backLinkFor', () => {
  it('returns to the builder with the built chain intact', () => {
    const from = '/?build=a,b,c&year=2026';
    const link = backLinkFor(from, CURRENT_SEASON);
    expect(link.href).toBe(from);
    expect(link.label).toBe('← Back to builder');
  });

  it('labels the other internal origins', () => {
    expect(backLinkFor('/swings?build=a', CURRENT_SEASON).label).toBe('← Back to the map');
    expect(backLinkFor('/schedule?build=a', CURRENT_SEASON).label).toBe('← Back to your schedule');
    expect(backLinkFor('/cuts?year=2026', CURRENT_SEASON).label).toBe(`← Back to ${CURRENT_SEASON} schedule`);
  });

  it('falls back to the cuts schedule when no origin is given', () => {
    expect(backLinkFor(undefined, CURRENT_SEASON).href).toBe('/cuts');
    expect(backLinkFor(undefined, 2024).href).toBe('/cuts?year=2024');
    expect(backLinkFor('', CURRENT_SEASON).href).toBe('/cuts');
  });

  it('refuses off-site targets so ?from= is not an open redirect', () => {
    for (const hostile of [
      '//evil.com',
      '//evil.com/path',
      'https://evil.com',
      'http://evil.com',
      'javascript:alert(1)',
      '/\\evil.com',
      'evil.com',
    ]) {
      expect(backLinkFor(hostile, CURRENT_SEASON).href).toBe('/cuts');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { flagFor } from './country-flag';

describe('flagFor', () => {
  it('maps the alpha-3 codes entry lists publish', () => {
    expect(flagFor('ITA')).toBe('🇮🇹');
    expect(flagFor('FRA')).toBe('🇫🇷');
    expect(flagFor('USA')).toBe('🇺🇸');
  });

  it('handles IOC codes that differ from ISO', () => {
    // These are the ones a naive alpha-3 slice gets wrong.
    expect(flagFor('GER')).toBe('🇩🇪');
    expect(flagFor('SUI')).toBe('🇨🇭');
    expect(flagFor('NED')).toBe('🇳🇱');
    expect(flagFor('RSA')).toBe('🇿🇦');
    expect(flagFor('URU')).toBe('🇺🇾');
    expect(flagFor('TPE')).toBe('🇹🇼');
  });

  it('accepts alpha-2 unchanged', () => {
    expect(flagFor('GB')).toBe('🇬🇧');
  });

  it('is case and whitespace tolerant', () => {
    expect(flagFor(' esp ')).toBe('🇪🇸');
  });

  // A wrong flag is worse than no flag, so unmapped codes fall back rather
  // than guessing from the first two letters.
  it('returns null for anything it cannot map', () => {
    expect(flagFor('XXX')).toBeNull();
    expect(flagFor('')).toBeNull();
    expect(flagFor(null)).toBeNull();
    expect(flagFor(undefined)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { fridayBefore, googleFlightsUrl } from './tournament-links';

describe('fridayBefore', () => {
  it('returns the Friday before a Monday start', () => {
    // 2026-07-13 is a Monday → 2026-07-10 is the Friday before.
    expect(fridayBefore('2026-07-13')).toBe('2026-07-10');
  });

  it('returns the previous Friday when the start is itself a Friday', () => {
    expect(fridayBefore('2026-07-10')).toBe('2026-07-03');
  });

  it('handles a Sunday start', () => {
    // 2026-07-12 is a Sunday → 2026-07-10.
    expect(fridayBefore('2026-07-12')).toBe('2026-07-10');
  });

  it('returns null for missing/invalid dates', () => {
    expect(fridayBefore(null)).toBeNull();
    expect(fridayBefore('not-a-date')).toBeNull();
  });
});

describe('googleFlightsUrl', () => {
  it('pins the one-way date when given', () => {
    const url = googleFlightsUrl('Cary', 'Newport', '2026-07-10');
    expect(decodeURIComponent(url)).toContain(
      'One-way flights to Newport from Cary on 2026-07-10'
    );
  });

  it('omits the date clause when none is given', () => {
    const url = googleFlightsUrl('Cary', 'Newport');
    expect(decodeURIComponent(url)).toContain('One-way flights to Newport from Cary');
    expect(url).not.toContain('%20on%20');
  });
});

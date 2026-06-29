import { describe, it, expect } from 'vitest';
import { fridayBefore, formatTravelDate, placeLabel, googleFlightsUrl } from './itinerary';

describe('fridayBefore', () => {
  it('returns the Friday before a Monday start', () => {
    // 2026-07-13 is a Monday → 2026-07-10 is the Friday before.
    expect(fridayBefore('2026-07-13')).toBe('2026-07-10');
  });

  it('returns the previous Friday for a start that is itself a Friday', () => {
    // 2026-07-10 is a Friday → a week earlier.
    expect(fridayBefore('2026-07-10')).toBe('2026-07-03');
  });

  it('handles a Sunday start', () => {
    // 2026-07-12 is a Sunday → 2026-07-10.
    expect(fridayBefore('2026-07-12')).toBe('2026-07-10');
  });

  it('returns null for an unparseable date', () => {
    expect(fridayBefore('not-a-date')).toBeNull();
  });
});

describe('formatTravelDate', () => {
  it('formats in UTC regardless of locale', () => {
    expect(formatTravelDate('2026-07-10')).toBe('Fri, Jul 10');
  });
});

describe('placeLabel', () => {
  it('joins city and country', () => {
    expect(placeLabel('Cary', 'United States')).toBe('Cary, United States');
  });
  it('falls back to city alone', () => {
    expect(placeLabel('Cary', null)).toBe('Cary');
  });
});

describe('googleFlightsUrl', () => {
  it('encodes a dated natural-language query', () => {
    const url = googleFlightsUrl('Cary, United States', 'Newport, United States', '2026-07-10');
    expect(url).toContain('https://www.google.com/travel/flights?q=');
    expect(decodeURIComponent(url)).toContain(
      'Flights from Cary, United States to Newport, United States on 2026-07-10'
    );
  });

  it('omits the date when none is given', () => {
    const url = googleFlightsUrl('Cary', 'Newport', null);
    expect(decodeURIComponent(url)).toContain('Flights from Cary to Newport');
    expect(url).not.toContain('%20on%20');
  });
});

import { describe, it, expect } from 'vitest';
import { buildOneWayTfs, googleFlightsResultsUrl } from './google-flights-tfs';

describe('buildOneWayTfs', () => {
  // Locked down against a URL that was actually loaded in a real browser and
  // confirmed to open "Paris to New York | Google Flights" with "One way"
  // selected, both airports correct, and price-tracking reading back the
  // exact date. If this value ever changes, the change must be re-verified
  // live before the test is updated — it is the one thing standing between
  // "the encoder is right" and "the encoder silently drifted."
  it('matches the verified CDG→JFK 2026-10-16 encoding', () => {
    expect(buildOneWayTfs('CDG', 'JFK', '2026-10-16')).toBe(
      'CBwQAhoeEgoyMDI2LTEwLTE2agcIARIDQ0RHcgcIARIDSkZLQAFIAXABmAEC'
    );
  });

  // Also verified live: opened "Rennes to Nice | Google Flights" with both
  // airport codes and "One way" read back correctly.
  it('matches the verified RNS→NCE 2026-09-18 encoding', () => {
    expect(buildOneWayTfs('RNS', 'NCE', '2026-09-18')).toBe(
      'CBwQAhoeEgoyMDI2LTA5LTE4agcIARIDUk5TcgcIARIDTkNFQAFIAXABmAEC'
    );
  });
});

describe('googleFlightsResultsUrl', () => {
  it('points at the tfs-based results endpoint, not travel/flights?q=', () => {
    const url = googleFlightsResultsUrl('CDG', 'JFK', '2026-10-16');
    expect(url.startsWith('https://www.google.com/travel/flights/search?tfs=')).toBe(true);
    expect(url).not.toContain('?q=');
  });
});

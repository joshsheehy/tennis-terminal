import { describe, expect, it } from 'vitest';
import { airportFor, nearestAirport } from './city-airports';
import { googleFlightsUrl } from './tournament-links';

describe('nearestAirport', () => {
  it('finds the closest scheduled-service airport', () => {
    expect(nearestAirport(35.96, -83.92)).toBe('TYS'); // Knoxville
    expect(nearestAirport(40.11, -88.24)).toBe('CMI'); // Champaign
    expect(nearestAirport(51.43, -0.21)).toMatch(/^(LHR|LCY)$/); // Wimbledon
  });
  it('gives up far from any airport rather than guessing', () => {
    expect(nearestAirport(-40, -130)).toBeNull(); // South Pacific
  });
});

describe('airportFor', () => {
  it('prefers the hand-verified mapping over the map', () => {
    expect(airportFor('Saint-Tropez', { latitude: 43.27, longitude: 6.64 })).toBe('NCE');
  });
  it('falls back to coordinates, or null without them', () => {
    expect(airportFor('Knoxville', { latitude: 35.96, longitude: -83.92 })).toBe('TYS');
    expect(airportFor('Knoxville')).toBeNull();
  });
});

describe('googleFlightsUrl', () => {
  it('opens a filled-in Google Flights search when both stops have coordinates', () => {
    const url = googleFlightsUrl('Knoxville', 'Champaign', '2026-11-13', { latitude: 35.96, longitude: -83.92 }, { latitude: 40.11, longitude: -88.24 });
    expect(url).toMatch(/^https:\/\/www\.google\.com\/travel\/flights.*tfs=/);
  });
  it('still falls back to a plain search when it cannot place a city', () => {
    expect(googleFlightsUrl('Nowhere', 'Champaign', '2026-11-13')).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
  });
});

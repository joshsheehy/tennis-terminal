import { describe, expect, it, vi } from 'vitest';
import {
  cleanCityForQuery,
  geocodeCityCountry,
  geocodeKey,
  parseNominatimResults,
} from './geocode';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const marseille = [
  { lat: '43.2963986', lon: '5.3777888', display_name: 'Marseille, France' },
];

describe('geocodeKey', () => {
  it('normalizes case and whitespace so equal places share a key', () => {
    expect(geocodeKey(' Buenos  Aires ', 'ARGENTINA')).toBe(
      geocodeKey('buenos aires', 'Argentina')
    );
  });

  it('keeps same city in different countries distinct', () => {
    expect(geocodeKey('Cordoba', 'Argentina')).not.toBe(geocodeKey('Cordoba', 'Spain'));
  });

  it('treats missing country as its own bucket', () => {
    expect(geocodeKey('Monastir', null)).toBe('monastir|');
  });
});

describe('cleanCityForQuery', () => {
  it('strips edition numbers and parentheticals', () => {
    expect(cleanCityForQuery('Oeiras 2')).toBe('Oeiras');
    expect(cleanCityForQuery('Istanbul (Indoor)')).toBe('Istanbul');
  });

  it('leaves ordinary city names alone', () => {
    expect(cleanCityForQuery('Buenos Aires')).toBe('Buenos Aires');
  });
});

describe('parseNominatimResults', () => {
  it('reads the first result', () => {
    expect(parseNominatimResults(marseille)).toEqual({
      latitude: 43.2963986,
      longitude: 5.3777888,
      displayName: 'Marseille, France',
    });
  });

  it('returns null for empty results instead of guessing', () => {
    expect(parseNominatimResults([])).toBeNull();
    expect(parseNominatimResults(undefined)).toBeNull();
  });

  it('rejects malformed or out-of-range coordinates', () => {
    expect(parseNominatimResults([{ lat: 'abc', lon: '5' }])).toBeNull();
    expect(parseNominatimResults([{ lat: '95', lon: '5' }])).toBeNull();
    expect(parseNominatimResults([{ lat: '43', lon: '999' }])).toBeNull();
  });
});

describe('geocodeCityCountry', () => {
  it('resolves via the structured city+country query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(marseille));

    const result = await geocodeCityCountry('Marseille', 'France', fetchMock);

    expect(result?.latitude).toBeCloseTo(43.2963986);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('city')).toBe('Marseille');
    expect(url.searchParams.get('country')).toBe('France');
  });

  it('falls back to a free-form query when the structured one misses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(marseille));

    const result = await geocodeCityCountry('Marseille', 'France', fetchMock);

    expect(result?.longitude).toBeCloseTo(5.3777888);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url.searchParams.get('q')).toBe('Marseille, France');
  });

  it('returns null when both queries miss', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse([]));

    expect(await geocodeCityCountry('Nowhereville', 'Atlantis', fetchMock)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cleans edition suffixes out of the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(marseille));

    await geocodeCityCountry('Oeiras 2', 'Portugal', fetchMock);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('city')).toBe('Oeiras');
  });

  it('throws on HTTP errors so callers can tell outages from misses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));

    await expect(geocodeCityCountry('Marseille', 'France', fetchMock)).rejects.toThrow('429');
  });
});

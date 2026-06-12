// Free-service geocoding for the Swings map view (phase 1).
//
// Uses Nominatim (OpenStreetMap). Their usage policy requires an identifying
// User-Agent with contact info and at most 1 request per second; callers must
// wait GEOCODE_MIN_INTERVAL_MS between calls (see geocode-tournaments script
// and /api/geocode-tournaments, which both rate-limit).
//
// No guessing: when Nominatim has no match we return null and the tournament
// goes into the failure report for manual resolution.

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export const GEOCODE_USER_AGENT =
  'tennis-terminal/1.0 (https://tennis-terminal-production.up.railway.app; josh@tenniscuts.com)';

// Nominatim allows 1 req/s; a small buffer keeps bursts safely under it.
export const GEOCODE_MIN_INTERVAL_MS = 1100;

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  /** Nominatim's resolved place name, kept for eyeballing dry runs. */
  displayName: string;
};

/**
 * Cache key for a city + country pair. Many tournaments share a venue city
 * (e.g. Tenerife 1/2, the Monastir blocks), so coordinates are looked up once
 * per distinct pair and reused.
 */
export function geocodeKey(city: string, country: string | null): string {
  return `${normalizePlace(city)}|${normalizePlace(country ?? '')}`;
}

/**
 * City strings sometimes carry edition suffixes or annotations that confuse
 * the geocoder ("Oeiras 2", "Istanbul (Indoor)"). Strip parentheticals and a
 * trailing standalone number; real city names do not end in a bare digit.
 */
export function cleanCityForQuery(city: string): string {
  return city
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract a usable coordinate from a Nominatim jsonv2 response. Returns null
 * for empty results or malformed/out-of-range coordinates — never guesses.
 */
export function parseNominatimResults(payload: unknown): GeocodeResult | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const first = payload[0] as { lat?: unknown; lon?: unknown; display_name?: unknown };
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return {
    latitude,
    longitude,
    displayName: typeof first.display_name === 'string' ? first.display_name : '',
  };
}

async function queryNominatim(
  params: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<GeocodeResult | null> {
  params.set('format', 'jsonv2');
  params.set('limit', '1');

  const response = await fetchImpl(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      'user-agent': GEOCODE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim responded with status ${response.status}`);
  }

  return parseNominatimResults(await response.json());
}

/**
 * Geocode a city + country. Tries Nominatim's structured query first (more
 * precise: the country constrains the match), then falls back to a free-form
 * "city, country" search. Throws on transport/HTTP errors so callers can
 * distinguish "service problem" from "place not found" (null).
 */
export async function geocodeCityCountry(
  city: string,
  country: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<GeocodeResult | null> {
  const cleanedCity = cleanCityForQuery(city);
  if (!cleanedCity) return null;

  const structured = new URLSearchParams({ city: cleanedCity });
  if (country) structured.set('country', country);

  const structuredResult = await queryNominatim(structured, fetchImpl);
  if (structuredResult) return structuredResult;

  const freeForm = new URLSearchParams({
    q: country ? `${cleanedCity}, ${country}` : cleanedCity,
  });

  return queryNominatim(freeForm, fetchImpl);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

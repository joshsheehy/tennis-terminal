import AIRPORTS from './airports.json';

// Nearest airport with real scheduled service, for tournament cities we know
// about — the one thing a real Google Flights link needs that free text
// can't provide (see google-flights-tfs.ts: entity_type=1 requires an exact
// three-letter IATA code, not a city name).
//
// Deliberately small and hand-verified rather than guessed at scale — a wrong
// code sends someone toward the wrong city with total confidence, which is
// worse than the honest "here's a Google search" fallback callers use when a
// city isn't listed here. Keyed on the tournament's `city` field exactly as
// stored (see tournament-data.ts / the DB), not on slug.
//
// Cities not listed here use the nearest scheduled-service airport (below);
// add a row when that guess is wrong for a city that matters. Most tour cities have their own airport (code is just
// that airport); some don't and the mapping is a judgment call — noted per
// row below.

export const CITY_AIRPORTS: Record<string, string> = {
  // Its own airport.
  Rennes: 'RNS',
  'Mouilleron-le-Captif': 'NTE', // no local airport; Nantes is the tournament's own travel advice
  'Mouilleron le Captif': 'NTE', // same city, alternate spelling stored on some editions

  // No commercial airport of its own (La Môle/Saint-Tropez airfield has
  // essentially no scheduled service) — Nice is the standard travel answer
  // for the French Riviera and how most players and fans actually get here.
  'Saint-Tropez': 'NCE',
};

// Fallback for every other city: the nearest airport with scheduled
// passenger service, from the tournament's own coordinates. Data: OurAirports
// (public domain), trimmed to large/medium airports with scheduled service
// and an IATA code — [code, lat, lng, isLarge].
// Beyond this there's no honest "nearest airport"; callers fall back to search.
const MAX_AIRPORT_KM = 150;

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestAirport(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestKm = MAX_AIRPORT_KM;
  for (const [code, aLat, aLng] of AIRPORTS as [string, number, number, number][]) {
    const d = km(lat, lng, aLat, aLng);
    if (d < bestKm) {
      bestKm = d;
      best = code;
    }
  }
  return best;
}

// Hand-verified mapping first (it encodes local knowledge the map can't),
// then the nearest scheduled-service airport to the tournament.
export function airportFor(city: string, coords?: { latitude?: number | null; longitude?: number | null } | null): string | null {
  const known = CITY_AIRPORTS[city];
  if (known) return known;
  if (coords?.latitude == null || coords?.longitude == null) return null;
  return nearestAirport(coords.latitude, coords.longitude);
}

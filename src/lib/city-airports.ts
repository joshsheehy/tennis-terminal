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
// Add a row here whenever a flight link falls back to plain search for a
// city that matters. Most tour cities have their own airport (code is just
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

export function airportFor(city: string): string | null {
  return CITY_AIRPORTS[city] ?? null;
}

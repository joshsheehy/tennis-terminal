// Helpers for the "finished swing" itinerary screen: travel dates between
// consecutive stops and outbound flight-search deep links. Kept pure (no DOM /
// no React) so they're easy to unit test.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseUtc(dateISO: string): Date | null {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The Friday immediately before a tournament's start date — the natural travel
 * day for the weekend ahead of a Monday main draw. Returns YYYY-MM-DD, or null
 * if the input can't be parsed. A start that already falls on a Friday maps to
 * the previous Friday (a week earlier).
 */
export function fridayBefore(startISO: string): string | null {
  const d = parseUtc(startISO);
  if (!d) return null;
  const dow = d.getUTCDay(); // 0 Sun … 5 Fri … 6 Sat
  const back = ((dow - 5 + 7) % 7) || 7;
  return toISODate(new Date(d.getTime() - back * DAY_MS));
}

/** "Fri, Jul 10" — short travel-date label (UTC, locale-independent). */
export function formatTravelDate(dateISO: string): string {
  const d = parseUtc(dateISO);
  if (!d) return dateISO;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Cary, United States" → a place label for a flight query. */
export function placeLabel(city: string, country: string | null): string {
  return country ? `${city}, ${country}` : city;
}

/**
 * Google Flights deep link. There's no documented query API, but the natural-
 * language `?q=` form reliably pre-fills origin, destination and date. We lead
 * with "One-way" so it doesn't default to a round trip — each leg of a swing is
 * a separate hop to the next stop.
 */
export function googleFlightsUrl(
  originLabel: string,
  destLabel: string,
  dateISO: string | null
): string {
  const q = dateISO
    ? `One-way flights from ${originLabel} to ${destLabel} on ${dateISO}`
    : `One-way flights from ${originLabel} to ${destLabel}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

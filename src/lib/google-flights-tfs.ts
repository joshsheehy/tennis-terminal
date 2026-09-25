// Hand-rolled encoder for Google Flights' `tfs` URL parameter — the only
// mechanism that actually opens a populated results page with real cities,
// a real date, and "One way" pre-selected.
//
// WHY THIS EXISTS: google.com/travel/flights?q=<free text> — what this
// project used before — stopped parsing its query entirely. Loaded that
// exact URL in a real browser: both city fields came back blank, no date,
// "Round trip" still selected. Whatever a user saw beyond that (a
// disconnected city, in one report) was Google's own fallback for a query it
// never read.
//
// `tfs` is not a documented API. It is a base64url-encoded protobuf message
// (proto2, no padding), reverse-engineered by the community from controlled
// Google Flights URL diffs. Field layout follows
// https://gist.github.com/MomoDeve/a18053dea84dd28e320b8b2c489540eb — see the
// comment on TFS_SPEC_FIELDS below for the specific fields used here.
//
// Verified live before shipping (not just built from the spec and trusted):
// CDG→JFK 2026-10-16 opened "Paris to New York | Google Flights" with real
// fares, "One way" selected, and the tracked date reading "departing
// 2026-10-16". RNS→NCE 2026-09-18 opened "Rennes to Nice | Google Flights"
// with both airport codes and the trip type correctly read back — Google
// simply had no inventory for that specific pair/date, which is a fact about
// available service, not about whether the link works. Encoder output for
// CDG→JFK is locked down as a regression test.
//
// Needs a real IATA airport code on both ends — see city-airports.ts. A city
// without one has no way into this URL at all (entity_type=1 requires an
// exact three-letter code, not a free-text name), so callers must fall back
// to something else when a code is missing.

function varint(nIn: number): number[] {
  let n = nIn;
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n & 0x7f);
  return bytes;
}

function tag(field: number, wireType: 0 | 2): number[] {
  return varint((field << 3) | wireType);
}

function lenDelim(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}

function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function strBytes(s: string): number[] {
  return [...Buffer.from(s, 'utf8')];
}

// message Place { entity_type = 1 (airport); entity_id = IATA code }
function place(iataCode: string): number[] {
  return [...varintField(1, 1), ...lenDelim(2, strBytes(iataCode))];
}

// message FlightLeg — only the three fields a bare one-way search needs:
// departure_date (field 2), origin (field 13), destination (field 14).
function flightLeg(dateISO: string, originIata: string, destIata: string): number[] {
  return [
    ...lenDelim(2, strBytes(dateISO)),
    ...lenDelim(13, place(originIata)),
    ...lenDelim(14, place(destIata)),
  ];
}

/**
 * The `tfs` value (base64url, no padding) for a one-way search.
 *
 * Field numbers, per the spec: 1 query_mode, 2 query_context (both constant
 * across every captured real search — kept for maximum compatibility, though
 * their actual effect is undocumented), 3 legs, 8 passengers (repeated,
 * PASSENGER_ADULT=1), 9 cabin (CABIN_ECONOMY=1), 14 display_flag (also
 * constant in every capture), 19 trip_type (TRIP_ONE_WAY=2).
 */
export function buildOneWayTfs(originIata: string, destIata: string, dateISO: string): string {
  const bytes = [
    ...varintField(1, 28),
    ...varintField(2, 2),
    ...lenDelim(3, flightLeg(dateISO, originIata, destIata)),
    ...varintField(8, 1),
    ...varintField(9, 1),
    ...varintField(14, 1),
    ...varintField(19, 2),
  ];
  return Buffer.from(bytes).toString('base64url');
}

export function googleFlightsResultsUrl(originIata: string, destIata: string, dateISO: string): string {
  const tfs = buildOneWayTfs(originIata, destIata, dateISO);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&hl=en&gl=US&curr=USD`;
}

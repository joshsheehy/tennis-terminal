import { ALL_EDITIONS } from './tournament-data';

// Shared link builders for tournament artefacts (ProTennisLive detail sheets)
// and travel. Used by the tournament detail page and the schedule summary.

export function isChallengerLevel(level: string): boolean {
  return level.toLowerCase().includes('challenger');
}

export function isAtpTourLevel(level: string): boolean {
  return /\batp\s*(250|500|1000)\b/i.test(level);
}

// Detail sheets (ds.pdf) only exist for ATP Tour + Challenger ProTennisLive
// postings — Grand Slams, ITF and team events have none.
export function levelGetsDetailSheet(level: string): boolean {
  return isChallengerLevel(level) || isAtpTourLevel(level);
}

// Most recent ProTennisLive code we know for a slug, from the static catalogue.
export function getProtennisliveCodeForSlug(slug: string): string | null {
  let bestCode: string | null = null;
  let bestYear = -Infinity;
  for (const entry of ALL_EDITIONS) {
    if (entry.tournament.slug !== slug) continue;
    if (!entry.edition.protennislive_code) continue;
    if (entry.edition.year > bestYear) {
      bestYear = entry.edition.year;
      bestCode = entry.edition.protennislive_code;
    }
  }
  return bestCode;
}

// Recover a ProTennisLive code: prefer the static catalogue, else the code
// embedded in the DB source_url for calendar-discovered events.
export function resolveProTennisLiveCode(
  slug: string,
  sourceUrl: string | null | undefined
): string | null {
  const fromCatalogue = getProtennisliveCodeForSlug(slug);
  if (fromCatalogue) return fromCatalogue;
  const m = (sourceUrl ?? '').match(/protennislive\.com\/posting\/\d{4}\/(\d+)/i);
  return m ? m[1] : null;
}

// Official ProTennisLive fact/detail sheet: /posting/{year}/{code}/ds.pdf.
export function detailSheetUrl(code: string, year: number): string {
  return `https://www.protennislive.com/posting/${year}/${code}/ds.pdf`;
}

// The detail-sheet URL for an edition, or null when the level/level code can't
// have one.
export function detailSheetUrlForEdition(edition: {
  level: string;
  slug: string;
  year: number;
  source_url?: string | null;
}): string | null {
  if (!levelGetsDetailSheet(edition.level)) return null;
  const code = resolveProTennisLiveCode(edition.slug, edition.source_url);
  return code ? detailSheetUrl(code, edition.year) : null;
}

// Google Flights deep link for a leg. Google reliably parses a natural-language
// query, and city names are what we have (no airport codes in the data). We
// lead with "One-way" so it doesn't default to a round trip — each leg of a
// swing is a one-way hop to the next stop.
export function googleFlightsUrl(fromCity: string, toCity: string): string {
  const q = `One-way flights to ${toCity} from ${fromCity}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

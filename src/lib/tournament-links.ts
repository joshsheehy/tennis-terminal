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

const PTL_CODE_IN_URL = /protennislive\.com\/posting\/\d{4}\/(\d+)/i;

export function ptlCodeFromUrl(url: string | null | undefined): string | null {
  return (url ?? '').match(PTL_CODE_IN_URL)?.[1] ?? null;
}

// Recover a ProTennisLive code: prefer the static catalogue, else the code
// embedded in the DB source_url for calendar-discovered events.
export function resolveProTennisLiveCode(
  slug: string,
  sourceUrl: string | null | undefined
): string | null {
  return getProtennisliveCodeForSlug(slug) ?? ptlCodeFromUrl(sourceUrl);
}

/**
 * The code for a tournament, from any URL its editions carry.
 *
 * The code belongs to the tournament, not to one edition — Prague is 600 every
 * year and Open de Vendée is 6857 every year — so a code found anywhere serves
 * every edition.
 *
 * Looking only at the catalogue and one edition's own source_url was too
 * narrow. A tournament missing from the catalogue lost its detail-sheet link on
 * every edition except whichever one happened to be imported from a
 * ProTennisLive URL: Open de Vendée offered a sheet for 2022 and nothing for
 * 2024, 2025 or 2026, while the same page linked the 2025 draw sheet under that
 * very code. The cut snapshots held it and nothing looked.
 *
 * @param candidateUrls URLs from the tournament's editions and cut snapshots,
 *   newest first — the most recent code is the one most likely still current.
 */
export function resolveTournamentPtlCode(
  slug: string,
  candidateUrls: Array<string | null | undefined>
): string | null {
  const fromCatalogue = getProtennisliveCodeForSlug(slug);
  if (fromCatalogue) return fromCatalogue;
  for (const url of candidateUrls) {
    const code = ptlCodeFromUrl(url);
    if (code) return code;
  }
  return null;
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

// The Friday immediately before a date (YYYY-MM-DD) — the natural travel day for
// the weekend ahead of a Monday main draw. Returns null if unparseable. A date
// that already falls on a Friday maps to the previous Friday (a week earlier).
export function fridayBefore(startISO: string | null | undefined): string | null {
  if (!startISO) return null;
  const d = new Date(`${startISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay(); // 0 Sun … 5 Fri … 6 Sat
  const back = ((dow - 5 + 7) % 7) || 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// Google Flights deep link for a leg. Google reliably parses a natural-language
// query, and city names are what we have (no airport codes in the data). We
// lead with "One-way" so it doesn't default to a round trip — each leg of a
// swing is a one-way hop to the next stop — and pin the date to the Friday
// between the two tournaments when we know it.
export function googleFlightsUrl(
  fromCity: string,
  toCity: string,
  dateISO?: string | null
): string {
  const q = dateISO
    ? `One-way flights to ${toCity} from ${fromCity} on ${dateISO}`
    : `One-way flights to ${toCity} from ${fromCity}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

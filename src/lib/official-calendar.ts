import slugify from 'slugify';
import { pool } from './db';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from './atp-week';
import { ALL_EDITIONS } from './tournament-data';
import { TOURNAMENT_ALIASES } from './tournament-aliases';

const ALIAS_TO_CANONICAL = new Map(TOURNAMENT_ALIASES.map((a) => [a.aliasSlug, a.canonicalSlug]));

// Two start dates at least this far apart are two different events, never one
// event that moved between PDF revisions (those shift by a week at most).
export const DISTINCT_EVENT_MIN_DAYS = 14;

export function daysApart(a: string | Date, b: string | Date) {
  const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(`${String(v).slice(0, 10)}T00:00:00Z`).getTime());
  return Math.abs(toMs(a) - toMs(b)) / 86400000;
}

// Shared logic for importing official ATP challenger-calendar rows, used by
// /api/sync-official-calendar (server-side PDF parse) and
// /api/import-official-rows (rows parsed off-server, e.g. in CI where the
// PDF fetch/parse is cheap and reliable, then POSTed here for upserting).

export type OfficialCalendarRow = {
  name: string;
  city: string;
  country: string | null;
  week: number;
  startDate: string;
  level: string;
  surface: string;
  indoor: boolean;
  sourcePdfUrl: string;
};

export const COUNTRY_BY_ATP_CODE: Record<string, string> = {
  ARG: 'Argentina', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium', BIH: 'Bosnia and Herzegovina',
  BOL: 'Bolivia', BRA: 'Brazil', BRN: 'Bahrain', BUL: 'Bulgaria', CAN: 'Canada', CGO: 'Congo',
  CHI: 'Chile', CHN: 'China', CIV: "Côte d'Ivoire", COL: 'Colombia', CRO: 'Croatia',
  CYP: 'Cyprus', CZE: 'Czech Republic', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt',
  ESP: 'Spain', FIN: 'Finland', FRA: 'France', GBR: 'Great Britain', GER: 'Germany', GRE: 'Greece',
  HKG: 'Hong Kong', HUN: 'Hungary', INA: 'Indonesia', IND: 'India', IRL: 'Ireland', ISR: 'Israel',
  ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan', KAZ: 'Kazakhstan', KOR: 'South Korea',
  MDA: 'Moldova', MEX: 'Mexico', NCL: 'New Caledonia', NED: 'Netherlands', NOR: 'Norway',
  NZL: 'New Zealand', PAR: 'Paraguay', POL: 'Poland', POR: 'Portugal', ROU: 'Romania',
  RSA: 'South Africa', RWA: 'Rwanda', SMR: 'San Marino', SUI: 'Switzerland', SVK: 'Slovakia',
  THA: 'Thailand', TPE: 'Chinese Taipei', TUN: 'Tunisia', TUR: 'Turkey', UAE: 'United Arab Emirates',
  USA: 'United States', UZB: 'Uzbekistan', VIE: 'Vietnam',
};

export function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function cleanName(value: string) {
  return value
    .replace(/[•†‡*]+/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveCity(name: string) {
  return cleanName(name).replace(/\s*\([^)]*\)/g, '').replace(/,\s*[A-Z]{2}$/g, '').trim();
}

export function fallbackSlugFor(name: string, city: string) {
  const base = deriveCity(name) || city || name;
  return slugify(base, { lower: true, strict: true, trim: true });
}

export function normalizeSurface(code: string) {
  const normalized = code.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (normalized === 'IH') return { surface: 'Indoor Hard', indoor: true };
  if (normalized === 'H') return { surface: 'Hard', indoor: false };
  if (normalized === 'C' || normalized === 'CL') return { surface: 'Clay', indoor: false };
  if (normalized === 'G') return { surface: 'Grass', indoor: false };
  return { surface: 'Hard', indoor: false };
}

export function findCanonical(name: string, city: string, editionYear: number) {
  const nameKey = normalizeKey(name);
  const cityKey = normalizeKey(city);
  return (
    ALL_EDITIONS.find((entry) => entry.edition.year === editionYear && normalizeKey(entry.tournament.name) === nameKey) ??
    ALL_EDITIONS.find(
      (entry) =>
        entry.edition.year === editionYear &&
        entry.edition.level.toLowerCase().includes('challenger') &&
        normalizeKey(entry.tournament.city) === cityKey &&
        (normalizeKey(entry.tournament.name) === cityKey || normalizeKey(entry.tournament.name).startsWith(cityKey)) &&
        // The INCOMING name must also be city-only-ish, not just the catalogue
        // entry's. Without this, a city hosting two Challengers in the same
        // year — "Santa Cruz de la Sierra" (catalogue, name === city) and
        // "Santa Cruz de la Sierra 2" (a second, uncatalogued event) — had the
        // "2" silently dropped: this branch matched on city alone and
        // resolved to the WRONG tournament_id, overwriting that other
        // event's real date with the incoming one's. Caught 2026-10-13 when
        // registering Santa Cruz de la Sierra 2's PTL code corrupted the
        // April Bolivia Open's 2026 edition.
        (nameKey === cityKey || nameKey.startsWith(cityKey))
    ) ??
    ALL_EDITIONS.find((entry) => normalizeKey(entry.tournament.name) === nameKey)
  );
}

// A tournament can hold only one edition per season ((tournament_id, year) is
// unique), but the official calendar has several cities hosting two separate
// Challengers in one season under the same catalogue name: Soma Bay (19 Jan
// and 30 Nov 2026), Bogotá (6 Jul and 30 Nov), Porto, Genoa, Istanbul,
// Alicante, Guangzhou, Buenos Aires. Both rows resolved to the same slug, so
// every night the later one overwrote the earlier one's date -- the earlier
// event disappeared from the schedule while still holding its cuts.
//
// So: if the slug's edition for this season is a different event (14+ days
// away), this row gets its own tournament. Which event keeps the main slug:
// the one matching the static catalogue's date when the catalogue has one
// (import-calendars rewrites that date every night, so fighting it would
// flip-flop), otherwise the earlier one. Rows arrive in date order, so the
// earlier event reclaims the main slug and the later one then moves aside.
async function slugForDistinctEvent(
  primarySlug: string,
  row: OfficialCalendarRow,
  editionYear: number,
  catalogueDate: string | null
): Promise<string> {
  const ownSlug = slugify(row.name, { lower: true, strict: true, trim: true });
  const candidates = Array.from(
    new Set([primarySlug, ownSlug, `${primarySlug}-2`, `${primarySlug}-3`, `${primarySlug}-4`].filter(Boolean))
  );
  for (const candidate of candidates) {
    if (candidate === primarySlug && catalogueDate) {
      if (daysApart(catalogueDate, row.startDate) < DISTINCT_EVENT_MIN_DAYS) return candidate;
      continue;
    }
    const existing = await pool.query<{ start_date: string | null }>(
      `select te.start_date::text as start_date
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.year = $2`,
      [candidate, editionYear]
    );
    const existingDate = existing.rows[0]?.start_date;
    if (!existingDate) return candidate;
    if (daysApart(existingDate, row.startDate) < DISTINCT_EVENT_MIN_DAYS) return candidate;
    // The main slug currently holds a LATER event than this one: this one is
    // the first of the pair, so it takes the main slug back.
    if (candidate === primarySlug && !catalogueDate && row.startDate < existingDate) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

export async function upsertOfficialRow(row: OfficialCalendarRow, requestedYear: number, dryRun: boolean) {
  const editionYear = getAtpEditionYearForStartDate(row.startDate, requestedYear);
  const week = getAtpWeekForSeason(row.startDate, editionYear) ?? row.week;
  const canonical = findCanonical(row.name, row.city, editionYear);
  const name = canonical?.tournament.name ?? row.name;
  const city = canonical?.tournament.city ?? row.city;
  const country = canonical?.tournament.country ?? row.country;
  const resolvedSlug = canonical?.tournament.slug ?? fallbackSlugFor(name, city);
  // Write straight to the canonical row of a known alias. Writing the alias
  // slug and leaving resolve-tournament-aliases to merge it back later meant
  // the same four tournaments were deleted and re-created every single night.
  const aliasedSlug = ALIAS_TO_CANONICAL.get(resolvedSlug) ?? resolvedSlug;
  const catalogueDate =
    canonical && canonical.edition.year === editionYear && ALIAS_TO_CANONICAL.get(resolvedSlug) == null
      ? canonical.edition.start_date
      : null;
  const slug = await slugForDistinctEvent(aliasedSlug, row, editionYear, catalogueDate);
  const isPrimarySlug = slug === aliasedSlug;
  const code = isPrimarySlug ? canonical?.edition.protennislive_code ?? null : null;
  const sourceUrl = code ? `${row.sourcePdfUrl} | https://www.protennislive.com/posting/${editionYear}/${code}/` : row.sourcePdfUrl;

  // dryRun result carries isNew=null (we don't touch the DB to check).
  const result = { slug, name, city, country, year: editionYear, week, startDate: row.startDate, level: row.level, surface: row.surface, sourceUrl, hasProTennisLiveCode: Boolean(code), isNew: null as boolean | null };
  if (dryRun) return result;

  const tournamentResult = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set
       name = excluded.name,
       city = excluded.city,
       country = excluded.country,
       updated_at = now()
     returning id`,
    // A second same-season event keeps its own calendar name ("Bogotá (Los
    // Lagartos)", "Soma Bay") rather than the catalogue name of the first.
    [slug, isPrimarySlug ? name : row.name, city, country]
  );

  // RETURNING (xmax = 0) distinguishes a fresh INSERT (xmax = 0) from an
  // ON CONFLICT UPDATE (xmax != 0), so callers can report exactly which
  // tournaments were newly discovered vs merely refreshed.
  const editionResult = await pool.query<{ inserted: boolean }>(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, end_date, level, surface,
       indoor, source, source_url, status, updated_at
     ) values ($1, $2, $3, $4, null, $5, $6, $7, 'atp_official_calendar_pdf', $8, 'held', now())
     on conflict (tournament_id, year) do update set
       week = excluded.week,
       start_date = excluded.start_date,
       level = excluded.level,
       surface = excluded.surface,
       indoor = excluded.indoor,
       source = excluded.source,
       -- Never drop a ProTennisLive code that is already on the row.
       --
       -- The code here comes only from the static catalogue, matched by name
       -- and city for this exact year, so a tournament that is not in that file
       -- gets none — 103 of the 260 rows in the 2026 calendar. Code discovery
       -- fills those in by writing the posting URL to source_url, and this
       -- upsert then overwrote it with a code-less calendar URL the next
       -- morning. Every discovered code was erased within a day, which is why
       -- the cut importer could never build a URL for those events no matter
       -- how often they were rediscovered.
       --
       -- The posting URL is carried forward alongside the fresh calendar URL;
       -- readers recover the code by regex and do not care about the order.
       --
       -- The \d here MUST be \\d: this whole query is a JS template literal,
       -- and an unrecognized escape like a single \d silently drops the
       -- backslash at parse time, so a single backslash sends Postgres the
       -- pattern /posting/d+/d+/ -- matches nothing, ever. That turned this
       -- guard into a no-op: every case fell through to the plain overwrite
       -- below, for as long as this existed.
       source_url = case
         when excluded.source_url ~ '/posting/\\d+/\\d+/' then excluded.source_url
         when tournament_editions.source_url ~ '/posting/\\d+/\\d+/'
           then excluded.source_url || ' | ' ||
                (regexp_match(tournament_editions.source_url, '(https?://[^ |]*/posting/\\d+/\\d+/)'))[1]
         else excluded.source_url
       end,
       status = 'held',
       updated_at = now()
     returning (xmax = 0) as inserted`,
    [tournamentResult.rows[0].id, editionYear, week, row.startDate, row.level, row.surface, row.indoor, sourceUrl]
  );

  return { ...result, isNew: editionResult.rows[0]?.inserted ?? false };
}

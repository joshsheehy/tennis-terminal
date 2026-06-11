import slugify from 'slugify';
import { pool } from './db';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from './atp-week';
import { ALL_EDITIONS } from './tournament-data';

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
        (normalizeKey(entry.tournament.name) === cityKey || normalizeKey(entry.tournament.name).startsWith(cityKey))
    ) ??
    ALL_EDITIONS.find((entry) => normalizeKey(entry.tournament.name) === nameKey)
  );
}

export async function upsertOfficialRow(row: OfficialCalendarRow, requestedYear: number, dryRun: boolean) {
  const editionYear = getAtpEditionYearForStartDate(row.startDate, requestedYear);
  const week = getAtpWeekForSeason(row.startDate, editionYear) ?? row.week;
  const canonical = findCanonical(row.name, row.city, editionYear);
  const name = canonical?.tournament.name ?? row.name;
  const city = canonical?.tournament.city ?? row.city;
  const country = canonical?.tournament.country ?? row.country;
  const slug = canonical?.tournament.slug ?? fallbackSlugFor(name, city);
  const code = canonical?.edition.protennislive_code ?? null;
  const sourceUrl = code ? `${row.sourcePdfUrl} | https://www.protennislive.com/posting/${editionYear}/${code}/` : row.sourcePdfUrl;

  const result = { slug, name, city, country, year: editionYear, week, startDate: row.startDate, level: row.level, surface: row.surface, sourceUrl, hasProTennisLiveCode: Boolean(code) };
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
    [slug, name, city, country]
  );

  await pool.query(
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
       source_url = excluded.source_url,
       status = 'held',
       updated_at = now()`,
    [tournamentResult.rows[0].id, editionYear, week, row.startDate, row.level, row.surface, row.indoor, sourceUrl]
  );

  return result;
}

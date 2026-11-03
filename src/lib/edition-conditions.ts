import { pool } from './db';
import { climateWindows, summarizeClimate, type ClimateSummary, type DailyWeather, type EditionConditions, type SheetConditions } from './conditions';
import { overrideCodeFor } from './ptl-code-overrides';
import { detailSheetUrl, levelGetsDetailSheet, resolveTournamentPtlCode } from './tournament-links';

// Storage for EditionConditions: one row per edition, filled by two syncs —
// /api/conditions/climate (Open-Meteo, from Railway) and /api/conditions/sheet
// (detail-sheet PDFs a GitHub runner downloads; protennislive.com rate-limits
// Railway). Created lazily like the other tables; sql/021_create_edition_conditions.sql
// is the schema of record.

export const CONDITIONS_CACHE_TAG = 'edition-conditions';

let ensured: Promise<void> | null = null;

export function ensureConditionsTable(): Promise<void> {
  ensured ??= pool
    .query(
      `create table if not exists edition_conditions (
         edition_id uuid primary key references tournament_editions(id) on delete cascade,
         elevation_m integer,
         temp_high_c smallint,
         temp_low_c smallint,
         rain_days numeric(3, 1),
         humidity_pct smallint,
         wind_kmh smallint,
         climate_updated_at timestamptz,
         ball text,
         court_brand text,
         sheet_surface text,
         sheet_url text,
         sheet_checked_at timestamptz,
         updated_at timestamptz not null default now()
       )`
    )
    .then(() => undefined)
    .catch((error) => {
      ensured = null;
      throw error;
    });
  return ensured;
}

/** Conditions for every edition in `year` that has any, keyed by edition id. */
export async function loadConditionsForYear(year: number): Promise<Record<string, EditionConditions>> {
  await ensureConditionsTable();
  const result = await pool.query<{
    edition_id: string;
    elevation_m: number | null;
    temp_high_c: number | null;
    temp_low_c: number | null;
    rain_days: string | null;
    humidity_pct: number | null;
    wind_kmh: number | null;
    ball: string | null;
    court_brand: string | null;
    indoor: boolean;
  }>(
    `select ec.edition_id, ec.elevation_m, ec.temp_high_c, ec.temp_low_c, ec.rain_days, ec.humidity_pct,
            ec.wind_kmh, ec.ball, ec.court_brand,
            (coalesce(te.indoor, false) or te.surface ilike '%indoor%' or coalesce(ec.sheet_surface, '') ilike 'indoor%') as indoor
     from edition_conditions ec
     join tournament_editions te on te.id = ec.edition_id
     where te.year = $1`,
    [year]
  );
  const out: Record<string, EditionConditions> = {};
  for (const row of result.rows) {
    out[row.edition_id] = {
      elevation: row.elevation_m,
      high: row.temp_high_c,
      low: row.temp_low_c,
      rainDays: row.rain_days == null ? null : Number(row.rain_days),
      humidity: row.humidity_pct,
      wind: row.wind_kmh,
      ball: row.ball,
      court: row.court_brand,
      indoor: row.indoor,
    };
  }
  return out;
}

export type ClimateTarget = { editionId: string; name: string; startDate: string; latitude: number; longitude: number };

/** Held editions starting from last week to `weeks` ahead, with coordinates and no climate yet. */
export async function climateTargets(weeks: number): Promise<ClimateTarget[]> {
  await ensureConditionsTable();
  const result = await pool.query<ClimateTarget>(
    `select te.id as "editionId", t.name, te.start_date::text as "startDate", t.latitude, t.longitude
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     left join edition_conditions ec on ec.edition_id = te.id
     where te.status = 'held'
       and t.latitude is not null and t.longitude is not null
       and te.start_date between current_date - 7 and current_date + ($1::int * 7)
       and ec.climate_updated_at is null
     order by te.start_date, t.name`,
    [weeks]
  );
  return result.rows;
}

const OPEN_METEO_UA = { 'User-Agent': 'TennisCuts conditions sync (tenniscuts.com)' };

async function openMeteo<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: OPEN_METEO_UA, cache: 'no-store' });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status} for ${url.split('?')[0]}`);
  return (await response.json()) as T;
}

/**
 * The edition week's weather in each of the five seasons before, plus the
 * venue's elevation. One small archive request per season (seven days each)
 * rather than five years of daily data, which Open-Meteo weighs as dozens of calls.
 */
export async function fetchClimate(target: ClimateTarget): Promise<{ climate: ClimateSummary | null; elevation: number | null }> {
  const windows = climateWindows(target.startDate);
  const days: DailyWeather[] = [];
  for (const window of windows) {
    const params = new URLSearchParams({
      latitude: String(target.latitude),
      longitude: String(target.longitude),
      start_date: window.start,
      end_date: window.end,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max',
      timezone: 'auto',
    });
    const data = await openMeteo<{ daily?: Record<string, Array<number | null>> }>(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    const daily = data.daily ?? {};
    const count = daily.temperature_2m_max?.length ?? 0;
    for (let i = 0; i < count; i += 1) {
      days.push({
        high: daily.temperature_2m_max?.[i] ?? null,
        low: daily.temperature_2m_min?.[i] ?? null,
        precipitation: daily.precipitation_sum?.[i] ?? null,
        humidity: daily.relative_humidity_2m_mean?.[i] ?? null,
        wind: daily.wind_speed_10m_max?.[i] ?? null,
      });
    }
  }
  const elevation = await openMeteo<{ elevation?: number[] }>(
    `https://api.open-meteo.com/v1/elevation?latitude=${target.latitude}&longitude=${target.longitude}`
  );
  const metres = elevation.elevation?.[0];
  return { climate: summarizeClimate(days, windows.length), elevation: metres == null ? null : Math.round(metres) };
}

export async function saveClimate(editionId: string, climate: ClimateSummary | null, elevation: number | null): Promise<void> {
  await ensureConditionsTable();
  await pool.query(
    `insert into edition_conditions (edition_id, elevation_m, temp_high_c, temp_low_c, rain_days, humidity_pct, wind_kmh, climate_updated_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now(), now())
     on conflict (edition_id) do update set
       elevation_m = excluded.elevation_m,
       temp_high_c = excluded.temp_high_c,
       temp_low_c = excluded.temp_low_c,
       rain_days = excluded.rain_days,
       humidity_pct = excluded.humidity_pct,
       wind_kmh = excluded.wind_kmh,
       climate_updated_at = now(),
       updated_at = now()`,
    [editionId, elevation, climate?.high ?? null, climate?.low ?? null, climate?.rainDays ?? null, climate?.humidity ?? null, climate?.wind ?? null]
  );
}

export type SheetTarget = { editionId: string; name: string; startDate: string; url: string };

// A sheet is often posted with blanks the tournament fills in later, so an
// incomplete one is read again after this long.
const SHEET_RECHECK_DAYS = 3;

/**
 * ATP/Challenger editions starting from last week to `weeks` ahead whose
 * detail sheet hasn't been read, or was read with a blank and is due a re-read.
 * The code comes from the same places /ds uses (catalogue, stored posting
 * URLs, ptl-code-overrides.ts).
 */
export async function sheetTargets(weeks: number, limit: number): Promise<SheetTarget[]> {
  await ensureConditionsTable();
  const editions = await pool.query<{ editionId: string; slug: string; name: string; startDate: string; year: number; level: string; sourceUrl: string | null }>(
    `select te.id as "editionId", t.slug, t.name, te.start_date::text as "startDate", te.year, te.level, te.source_url as "sourceUrl"
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     left join edition_conditions ec on ec.edition_id = te.id
     where te.status = 'held'
       and te.start_date between current_date - 7 and current_date + ($1::int * 7)
       and (ec.sheet_checked_at is null
            or ((ec.ball is null or ec.court_brand is null)
                and ec.sheet_checked_at < now() - ($2::int * interval '1 day')))
     order by te.start_date, t.name`,
    [weeks, SHEET_RECHECK_DAYS]
  );
  const eligible = editions.rows.filter((row) => levelGetsDetailSheet(row.level));
  if (eligible.length === 0) return [];

  // Any season's stored posting URL carries the tournament's code.
  const urls = await pool.query<{ slug: string; url: string | null }>(
    `select distinct t.slug, te.source_url as url
     from tournament_editions te join tournaments t on t.id = te.tournament_id
     where t.slug = any($1) and te.source_url like '%protennislive.com/posting/%'
     union
     select distinct t.slug, substring(cs.source_notes from 'protennislive\\.com/posting/[0-9]{4}/[0-9]+') as url
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where t.slug = any($1) and cs.source_notes like '%protennislive.com/posting/%'`,
    [eligible.map((row) => row.slug)]
  );
  const urlsBySlug = new Map<string, string[]>();
  for (const { slug, url } of urls.rows) {
    if (url) urlsBySlug.set(slug, [...(urlsBySlug.get(slug) ?? []), url]);
  }

  const targets: SheetTarget[] = [];
  for (const row of eligible) {
    const code = resolveTournamentPtlCode(row.slug, [row.sourceUrl, ...(urlsBySlug.get(row.slug) ?? [])]) ?? overrideCodeFor(row.slug);
    if (!code) continue;
    targets.push({ editionId: row.editionId, name: row.name, startDate: row.startDate, url: detailSheetUrl(code, row.year) });
    if (targets.length >= limit) break;
  }
  return targets;
}

export async function saveSheet(editionId: string, sheet: SheetConditions, url: string | null): Promise<void> {
  await ensureConditionsTable();
  await pool.query(
    `insert into edition_conditions (edition_id, ball, court_brand, sheet_surface, sheet_url, sheet_checked_at, updated_at)
     values ($1, $2, $3, $4, $5, now(), now())
     on conflict (edition_id) do update set
       ball = coalesce(excluded.ball, edition_conditions.ball),
       court_brand = coalesce(excluded.court_brand, edition_conditions.court_brand),
       sheet_surface = coalesce(excluded.sheet_surface, edition_conditions.sheet_surface),
       sheet_url = coalesce(excluded.sheet_url, edition_conditions.sheet_url),
       sheet_checked_at = now(),
       updated_at = now()`,
    [editionId, sheet.ball, sheet.courtBrand, sheet.surface, url]
  );
}

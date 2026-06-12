import slugify from 'slugify';
import { getAtpWeekForSeason } from './atp-week';

// ITF World Tennis Tour calendar import.
//
// Source: the JSON API behind itftennis.com's tournament calendar page:
//   https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar
//     ?circuitCode=MT&dateFrom=YYYY-01-01&dateTo=YYYY-12-31&skip=0&take=100...
// circuitCode MT = men's World Tennis Tour (M15/M25), WT = women's.
//
// ITF events repeat weekly in the same city under the same name
// ("M15 Monastir" runs ~40 weeks a year), and tournament_editions is unique
// on (tournament_id, year) — so each ITF event-week gets its OWN tournament
// row, with a slug namespaced by start date: itf-m15-monastir-2026-06-15.
// The itf- prefix guarantees no collision with ATP/Challenger slugs, and
// every cut-related sweep in the API excludes level ILIKE 'ITF%'.

export const ITF_SOURCE = 'itf_calendar_api';
export const ITF_BASE_URL = 'https://www.itftennis.com';

export const ITF_CIRCUITS: Record<string, string> = {
  men: 'MT',
  women: 'WT',
};

export type ParsedItfEvent = {
  slug: string;
  name: string;
  city: string;
  country: string | null;
  year: number;
  week: number | null;
  start_date: string;
  end_date: string | null;
  level: string;
  surface: string;
  indoor: boolean;
  source_url: string | null;
};

export type ItfParseFailure = { reason: string; raw: Record<string, unknown> };

type RawItem = Record<string, unknown>;

// The ITF API has shifted field casing/naming over time, so every field is
// read from a list of candidates instead of one hard-coded key.
function pick(raw: RawItem, candidates: string[]): unknown {
  // Case-insensitive key lookup so e.g. startDate / StartDate both work.
  const byLower = new Map(Object.keys(raw).map((k) => [k.toLowerCase(), raw[k]]));
  for (const c of candidates) {
    const v = byLower.get(c.toLowerCase());
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function pickString(raw: RawItem, candidates: string[]): string | null {
  const v = pick(raw, candidates);
  return v === null ? null : String(v).trim();
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  // Accept "2026-06-15", "2026-06-15T00:00:00", "2026-06-15T00:00:00Z", or
  // anything Date can parse; normalize to YYYY-MM-DD.
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// "M15", "M25", "15", "M15K"… → "M15"; anything unrecognized → null.
function normalizeCategory(value: string | null): string | null {
  if (!value) return null;
  const match = value.toUpperCase().match(/M\s*(\d{2})/) ?? value.match(/^(\d{2})\s*K?$/i);
  if (!match) return null;
  return `M${match[1]}`;
}

function normalizeSurface(value: string | null): { surface: string; indoorFromSurface: boolean } {
  if (!value) return { surface: 'Unknown', indoorFromSurface: false };
  const indoorFromSurface = /indoor/i.test(value);
  // "Clay - Outdoor" / "Hard Indoor" / "Carpet" → "Clay" / "Hard" / "Carpet"
  const base = value
    .replace(/\b(indoor|outdoor)\b/gi, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const canonical = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  return { surface: canonical || 'Unknown', indoorFromSurface };
}

export function parseItfCalendarItem(
  raw: RawItem,
  seasonYear: number
): ParsedItfEvent | ItfParseFailure {
  const name = pickString(raw, ['tournamentName', 'name', 'promotionalName', 'title']);
  const startRaw = pickString(raw, ['startDate', 'dateFrom', 'fromDate', 'start']);
  const endRaw = pickString(raw, ['endDate', 'dateTo', 'toDate', 'end']);
  const start_date = toIsoDate(startRaw);

  if (!name) return { reason: 'missing tournament name', raw };
  if (!start_date) return { reason: `unparseable start date "${startRaw ?? ''}"`, raw };
  // Trust the requested season window, but guard against the API returning
  // neighbouring-year rows at the window edges. ITF's season opener can start
  // in late December of the prior year (e.g. "M25 Marrakech, 29 Dec to 04 Jan
  // 2026" → start 2025-12-29 in the 2026 calendar); those count as week 1.
  const startYear = Number(start_date.slice(0, 4));
  const inSeason =
    startYear === seasonYear ||
    (startYear === seasonYear - 1 &&
      start_date.slice(5, 7) === '12' &&
      Number(start_date.slice(8, 10)) >= 26);
  if (!inSeason) {
    return { reason: `start date ${start_date} outside season ${seasonYear}`, raw };
  }

  const city =
    pickString(raw, ['location', 'venue', 'city', 'hostCity', 'town', 'siteCity']) ??
    // Most ITF names are "M15 <City>" — recover the city from the name.
    name.replace(/^[MW]\s?\d{2}\+?\s*/i, '').trim();
  const country = pickString(raw, [
    'hostNation', 'nationName', 'country', 'countryName', 'nation', 'hostNationCode', 'nationCode',
  ]);
  const category = normalizeCategory(
    pickString(raw, ['category', 'tournamentCategory', 'categoryCode', 'circuitCategory', 'prizeMoney'])
  ) ?? normalizeCategory(name);
  const { surface, indoorFromSurface } = normalizeSurface(
    pickString(raw, ['surfaceDesc', 'surface', 'courtSurface', 'surfaceName'])
  );
  const indoorField = pickString(raw, ['indoorOrOutdoor', 'inOutdoor', 'indoor']);
  const indoor = indoorFromSurface || /^(i|indoor|true)$/i.test(indoorField ?? '');

  const link = pickString(raw, ['tournamentLink', 'link', 'url', 'tournamentUrl']);
  const source_url = link
    ? link.startsWith('http') ? link : `${ITF_BASE_URL}${link.startsWith('/') ? '' : '/'}${link}`
    : null;

  const level = category ? `ITF ${category}` : 'ITF';
  const slug = slugify(`itf-${name}-${start_date}`, { lower: true, strict: true, trim: true });

  return {
    slug,
    name,
    city,
    country,
    year: seasonYear,
    week: getAtpWeekForSeason(start_date, seasonYear),
    start_date,
    end_date: toIsoDate(endRaw),
    level,
    surface,
    indoor,
    source_url,
  };
}

export function isParseFailure(v: ParsedItfEvent | ItfParseFailure): v is ItfParseFailure {
  return 'reason' in v;
}

export type ItfCalendarPage = { totalItems: number | null; items: RawItem[] };

// Tolerates { items, totalItems } / { Items, TotalItems } / bare arrays.
export function parseItfCalendarResponse(json: unknown): ItfCalendarPage {
  if (Array.isArray(json)) return { totalItems: null, items: json as RawItem[] };
  if (json && typeof json === 'object') {
    const obj = json as RawItem;
    const byLower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
    const items = byLower.get('items') ?? byLower.get('results') ?? byLower.get('data');
    const total = byLower.get('totalitems') ?? byLower.get('totalcount') ?? byLower.get('total');
    if (Array.isArray(items)) {
      return {
        totalItems: typeof total === 'number' ? total : Number(total) || null,
        items: items as RawItem[],
      };
    }
  }
  throw new Error(
    `Unrecognized ITF calendar response shape (keys: ${
      json && typeof json === 'object' ? Object.keys(json as object).join(', ') : typeof json
    })`
  );
}

export function buildItfCalendarUrl(year: number, circuitCode: string, skip: number, take: number): string {
  const params = new URLSearchParams({
    circuitCode,
    searchString: '',
    skip: String(skip),
    take: String(take),
    nationCodes: '',
    zoneCodes: '',
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    indoorOutdoor: '',
    categories: '',
    isOrderAscending: 'true',
    orderField: 'startDate',
    surfaceCodes: '',
  });
  return `${ITF_BASE_URL}/tennis/api/TournamentApi/GetCalendar?${params.toString()}`;
}

export async function fetchItfCalendarPage(
  year: number,
  circuitCode: string,
  skip: number,
  take: number
): Promise<ItfCalendarPage> {
  const url = buildItfCalendarUrl(year, circuitCode, skip, take);
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      // The ITF edge occasionally rejects empty/bot UAs.
      'user-agent': 'Mozilla/5.0 (compatible; TennisTerminal/1.0; +https://tenniscuts.com)',
    },
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ITF API ${response.status} for ${url} — body starts: ${text.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ITF API returned non-JSON for ${url} — body starts: ${text.slice(0, 200)}`);
  }
  return parseItfCalendarResponse(json);
}

export type ItfUpsertSummary = {
  upsertedTournaments: number;
  upsertedEditions: number;
  errors: Array<{ slug: string; error: string }>;
};

// Same upsert pattern as import-calendars: tournaments keyed by slug,
// editions keyed by (tournament_id, year). Since ITF slugs embed the start
// date, each event-week is its own tournament row with exactly one edition
// per year, and re-imports are idempotent.
export async function upsertItfEvents(events: ParsedItfEvent[]): Promise<ItfUpsertSummary> {
  // Lazy import keeps this module loadable without DATABASE_URL, so CI can
  // use the fetch/parse half on a runner (itftennis.com's Incapsula wall
  // blocks Railway's datacenter IPs but lets GitHub runners through).
  const { pool } = await import('./db');
  const summary: ItfUpsertSummary = { upsertedTournaments: 0, upsertedEditions: 0, errors: [] };

  for (const ev of events) {
    try {
      const tournament = await pool.query<{ id: string }>(
        `insert into tournaments (slug, name, city, country, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (slug) do update set
           name = excluded.name,
           city = excluded.city,
           country = excluded.country,
           updated_at = now()
         returning id`,
        [ev.slug, ev.name, ev.city, ev.country]
      );
      summary.upsertedTournaments += 1;

      await pool.query(
        `insert into tournament_editions (
           tournament_id, year, week, start_date, end_date,
           level, surface, indoor, source, source_url, status, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', now())
         on conflict (tournament_id, year) do update set
           week = excluded.week,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           level = excluded.level,
           surface = excluded.surface,
           indoor = excluded.indoor,
           source = excluded.source,
           source_url = excluded.source_url,
           status = 'held',
           updated_at = now()`,
        [
          tournament.rows[0].id,
          ev.year, ev.week, ev.start_date, ev.end_date,
          ev.level, ev.surface, ev.indoor, ITF_SOURCE, ev.source_url,
        ]
      );
      summary.upsertedEditions += 1;
    } catch (err) {
      summary.errors.push({ slug: ev.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

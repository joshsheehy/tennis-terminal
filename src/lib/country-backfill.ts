// Country backfill: fills tournaments.country where NULL (additive UPDATE on
// one nullable column; never overwrites an existing value). Two passes:
//   1. free: copy from another tournament sharing the same (cleaned) city
//      name that has a country
//   2. Nominatim reverse geocoding from the tournament's coordinates
// Dry-run by default, same throttle/429 contract as the coordinate backfill.

import type { Pool } from 'pg';
import {
  GEOCODE_MIN_INTERVAL_MS,
  NominatimRateLimitError,
  cleanCityForQuery,
  reverseGeocodeCountry,
  sleep,
} from './geocode';
import { AVAILABLE_SEASONS } from './seasons';

export type CountryFillRow = {
  slug: string;
  name: string;
  city: string;
  country: string;
  source: 'city-sibling' | 'nominatim-reverse';
};

export type CountryFillFailure = {
  slug: string;
  name: string;
  city: string;
  reason: string;
};

export type CountryBackfillResult = {
  dryRun: boolean;
  totalMissing: number;
  processed: number;
  resolved: CountryFillRow[];
  failures: CountryFillFailure[];
  written: number;
  remaining: number;
  nominatimRequests: number;
  rateLimited: boolean;
};

type Target = {
  id: string;
  slug: string;
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
};

export async function runCountryBackfill(
  pool: Pool,
  options: {
    dryRun: boolean;
    limit?: number;
    fetchImpl?: typeof fetch;
    sleepImpl?: (ms: number) => Promise<void>;
  }
): Promise<CountryBackfillResult> {
  const { dryRun, limit } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const seasons = [...AVAILABLE_SEASONS];

  const missingFilter = `
    t.country is null
    and exists (
      select 1 from tournament_editions te
      where te.tournament_id = t.id
        and te.status = 'held'
        and te.year = any($1::int[])
    )
  `;

  const totalResult = await pool.query<{ cnt: string }>(
    `select count(*) as cnt from tournaments t where ${missingFilter}`,
    [seasons]
  );
  const totalMissing = Number(totalResult.rows[0].cnt);

  // Pass-1 lookup: cleaned city name -> known country, from rows that have one.
  const knownResult = await pool.query<{ city: string; country: string }>(
    `select city, country from tournaments where country is not null`
  );
  const cityToCountry = new Map<string, string>();
  for (const row of knownResult.rows) {
    const key = cleanCityForQuery(row.city).toLowerCase();
    if (key && !cityToCountry.has(key)) cityToCountry.set(key, row.country);
  }

  const targetsResult = await pool.query<Target>(
    `select t.id, t.slug, t.name, t.city, t.latitude, t.longitude
     from tournaments t
     where ${missingFilter}
     order by t.city, t.slug
     ${limit ? 'limit $2' : ''}`,
    limit ? [seasons, limit] : [seasons]
  );

  const resolved: CountryFillRow[] = [];
  const failures: CountryFillFailure[] = [];
  let written = 0;
  let nominatimRequests = 0;
  let rateLimited = false;

  let lastRequestAt = 0;
  const throttle = async () => {
    const wait = lastRequestAt + GEOCODE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastRequestAt = Date.now();
    nominatimRequests += 1;
  };
  const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000];

  for (const target of targetsResult.rows) {
    const cityKey = cleanCityForQuery(target.city).toLowerCase();
    let country = cityToCountry.get(cityKey) ?? null;
    let source: CountryFillRow['source'] = 'city-sibling';

    if (!country && target.latitude != null && target.longitude != null) {
      source = 'nominatim-reverse';
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            country = await reverseGeocodeCountry(
              target.latitude,
              target.longitude,
              fetchImpl,
              throttle
            );
            break;
          } catch (err) {
            if (!(err instanceof NominatimRateLimitError)) throw err;
            if (attempt >= RATE_LIMIT_BACKOFF_MS.length) {
              rateLimited = true;
              break;
            }
            await sleepImpl(RATE_LIMIT_BACKOFF_MS[attempt]);
          }
        }
      } catch (err) {
        failures.push({
          slug: target.slug,
          name: target.name,
          city: target.city,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (rateLimited) break;
    }

    if (!country) {
      failures.push({
        slug: target.slug,
        name: target.name,
        city: target.city,
        reason:
          target.latitude == null
            ? 'no coordinates and no same-city sibling with a country'
            : 'reverse geocoding returned no country',
      });
      continue;
    }

    if (cityKey) cityToCountry.set(cityKey, country);
    resolved.push({
      slug: target.slug,
      name: target.name,
      city: target.city,
      country,
      source,
    });

    if (!dryRun) {
      await pool.query(
        `update tournaments set country = $1, updated_at = now()
         where id = $2 and country is null`,
        [country, target.id]
      );
      written += 1;
    }
  }

  return {
    dryRun,
    totalMissing,
    processed: targetsResult.rows.length,
    resolved,
    failures,
    written,
    remaining: totalMissing - written,
    nominatimRequests,
    rateLimited,
  };
}

// Shared engine for the coordinate backfill (Swings phase 1), used by both
// the CLI script (src/scripts/geocode-tournaments.ts) and the admin route
// (/api/geocode-tournaments). Dry-run by default everywhere: callers must
// explicitly opt in to writes.

import type { Pool } from 'pg';
import {
  GEOCODE_MIN_INTERVAL_MS,
  GeocodeResult,
  NominatimRateLimitError,
  geocodeCityCountry,
  geocodeKey,
  sleep,
} from './geocode';
import { AVAILABLE_SEASONS } from './seasons';

export type GeocodeTarget = {
  id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
};

export type ResolvedRow = {
  slug: string;
  name: string;
  city: string;
  country: string | null;
  latitude: number;
  longitude: number;
  displayName: string;
  /** Where the coordinate came from: a live Nominatim hit, or reuse of an
   * already-resolved identical city+country (other tournament row or cache). */
  source: 'nominatim' | 'reused';
};

export type GeocodeFailure = {
  slug: string;
  name: string;
  city: string;
  country: string | null;
  reason: string;
};

export type BackfillResult = {
  dryRun: boolean;
  /** Seasons this run targeted. */
  years: number[];
  /** Tournaments with 2024-2026 held editions still missing coordinates before this run. */
  totalMissing: number;
  processed: number;
  resolved: ResolvedRow[];
  failures: GeocodeFailure[];
  written: number;
  remaining: number;
  nominatimRequests: number;
  /** True when Nominatim kept answering 429 after backoff: the run stopped
   * early and unprocessed tournaments were NOT recorded as failures. */
  rateLimited: boolean;
};

export type BackfillOptions = {
  dryRun: boolean;
  /** Max tournaments to process this run (keeps admin-route calls bounded). */
  limit?: number;
  /** Seasons whose tournaments to backfill; defaults to all AVAILABLE_SEASONS. */
  years?: number[];
  /** Pre-seeded cache keyed by geocodeKey(); new hits are added to it so the
   * CLI can persist it between runs. */
  cache?: Map<string, GeocodeResult>;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to the real rate-limit pause. */
  sleepImpl?: (ms: number) => Promise<void>;
};

// The migration this applies is sql/006_add_tournament_coordinates.sql; kept
// idempotent here (matching the /api/setup pattern) so the deployed app can
// bring production up to date without a separate psql session.
export async function ensureCoordinateColumns(pool: Pool): Promise<void> {
  await pool.query('alter table tournaments add column if not exists latitude double precision');
  await pool.query('alter table tournaments add column if not exists longitude double precision');
}

const MISSING_COORDS_FILTER = `
  (t.latitude is null or t.longitude is null)
  and exists (
    select 1
    from tournament_editions te
    where te.tournament_id = t.id
      and te.status = 'held'
      and te.year = any($1::int[])
  )
`;

export async function runGeocodeBackfill(
  pool: Pool,
  options: BackfillOptions
): Promise<BackfillResult> {
  const { dryRun, limit, cache = new Map<string, GeocodeResult>() } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const seasons = options.years && options.years.length > 0 ? options.years : [...AVAILABLE_SEASONS];

  await ensureCoordinateColumns(pool);

  const totalResult = await pool.query<{ cnt: string }>(
    `select count(*) as cnt from tournaments t where ${MISSING_COORDS_FILTER}`,
    [seasons]
  );
  const totalMissing = Number(totalResult.rows[0].cnt);

  // Reuse what previous runs already resolved: any tournament row that shares
  // a city+country with one that has coordinates never hits Nominatim again.
  const knownResult = await pool.query<{
    city: string;
    country: string | null;
    latitude: number;
    longitude: number;
  }>(
    `select distinct on (lower(city), lower(coalesce(country, '')))
       city, country, latitude, longitude
     from tournaments
     where latitude is not null and longitude is not null`
  );
  for (const row of knownResult.rows) {
    const key = geocodeKey(row.city, row.country);
    if (!cache.has(key)) {
      cache.set(key, { latitude: row.latitude, longitude: row.longitude, displayName: '' });
    }
  }

  // Ordering groups identical cities together and keeps reruns deterministic.
  const targetsResult = await pool.query<GeocodeTarget>(
    `select t.id, t.slug, t.name, t.city, t.country
     from tournaments t
     where ${MISSING_COORDS_FILTER}
     order by t.country nulls last, t.city, t.slug
     ${limit ? 'limit $2' : ''}`,
    limit ? [seasons, limit] : [seasons]
  );

  const resolved: ResolvedRow[] = [];
  const failures: GeocodeFailure[] = [];
  let written = 0;
  let nominatimRequests = 0;
  let rateLimited = false;

  // Awaited before every Nominatim HTTP request (the fallback query too),
  // keeping the whole run at or under 1 request per second.
  let lastRequestAt = 0;
  const throttle = async () => {
    const wait = lastRequestAt + GEOCODE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastRequestAt = Date.now();
    nominatimRequests += 1;
  };

  // On 429, retry with growing pauses; if Nominatim is still throttling
  // after the last attempt, give up on the whole run (rateLimited: true)
  // instead of burning every remaining tournament into the failure report.
  const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000];

  for (const target of targetsResult.rows) {
    const key = geocodeKey(target.city, target.country);
    let coords = cache.get(key) ?? null;
    let source: ResolvedRow['source'] = 'reused';

    if (!coords) {
      source = 'nominatim';
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            coords = await geocodeCityCountry(target.city, target.country, fetchImpl, throttle);
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
          country: target.country,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (rateLimited) break;
    }

    if (!coords) {
      failures.push({
        slug: target.slug,
        name: target.name,
        city: target.city,
        country: target.country,
        reason: 'no Nominatim match for city + country',
      });
      continue;
    }

    cache.set(key, coords);
    resolved.push({
      slug: target.slug,
      name: target.name,
      city: target.city,
      country: target.country,
      latitude: coords.latitude,
      longitude: coords.longitude,
      displayName: coords.displayName,
      source,
    });

    if (!dryRun) {
      await pool.query(
        `update tournaments
         set latitude = $1, longitude = $2, updated_at = now()
         where id = $3 and (latitude is null or longitude is null)`,
        [coords.latitude, coords.longitude, target.id]
      );
      written += 1;
    }
  }

  return {
    dryRun,
    years: seasons,
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

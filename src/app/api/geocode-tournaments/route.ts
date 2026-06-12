import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runGeocodeBackfill } from '@/lib/geocode-backfill';
import { isAvailableSeason } from '@/lib/seasons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Coordinate backfill for the Swings map view (phase 1). Applies the
// idempotent migration from sql/006_add_tournament_coordinates.sql, then
// geocodes tournaments (with 2024-2026 held editions) that are missing
// coordinates via Nominatim at 1 req/s, reusing coordinates across
// tournaments that share a city + country.
//
// ?dryRun=false writes; the default reports what would be written.
// ?year=2026 restricts the run to tournaments with editions in that season
// (default: all available seasons).
// ?limit=N bounds a run (default 40, max 150) so each call stays well inside
// request timeouts — call repeatedly until `remaining` is 0. The
// geocode-backfill.yml workflow does that paging automatically.

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 150;

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';

  const yearParam = request.nextUrl.searchParams.get('year');
  let years: number[] | undefined;
  if (yearParam && yearParam !== 'all') {
    const year = Number(yearParam);
    if (!isAvailableSeason(year)) {
      return NextResponse.json(
        { ok: false, error: `Unknown season "${yearParam}". Use 2024, 2025, 2026 or all.` },
        { status: 400 }
      );
    }
    years = [year];
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const result = await runGeocodeBackfill(pool, { dryRun, limit, years });

    return NextResponse.json({
      ok: true,
      dryRun: result.dryRun,
      years: result.years,
      missingBeforeRun: result.totalMissing,
      processed: result.processed,
      resolvedCount: result.resolved.length,
      failedCount: result.failures.length,
      written: result.written,
      remaining: result.remaining,
      nominatimRequests: result.nominatimRequests,
      rateLimited: result.rateLimited,
      resolved: result.resolved,
      failures: result.failures,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

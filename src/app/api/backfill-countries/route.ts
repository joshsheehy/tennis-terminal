import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runCountryBackfill } from '@/lib/country-backfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fills tournaments.country where NULL (additive; existing values are never
// touched). Pass 1 copies from a same-city tournament that has a country;
// pass 2 reverse-geocodes the tournament's coordinates via Nominatim at
// 1 req/s. Imported rows (JeffSackmann, some official PDFs) often lack the
// country, which weakens swing detection's same-country rule and labels.
//
// ?dryRun=false writes; ?limit=N bounds a run (default 100, max 300).
// Call repeatedly until `remaining` is 0.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const result = await runCountryBackfill(pool, { dryRun, limit });

    return NextResponse.json({
      ok: true,
      dryRun: result.dryRun,
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

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { AVAILABLE_SEASONS, isAvailableSeason } from '@/lib/seasons';
import { allLevelScopes, parseScopeKey, scopeKey } from '@/lib/swings';
import { describeSwing, recomputeSwingsForYear } from '@/lib/swings-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Swing detection (phase 2): chains of tournaments in consecutive weeks that
// are close enough to play back-to-back. Detection is pure computation over
// tournament_editions + coordinates; persistence only touches the additive
// swings/swing_events tables.
//
// ?dryRun=false persists (delete + reinsert per year + level scope); the
// default just computes and returns the swing list for review.
// ?year=2026 limits to one season (default: all available seasons).
// ?scope=atp+challenger limits to one level scope (default: all 7 scopes so
//   ATP/Challenger/ITF filter combinations are all available to the UI).
// The swings-recompute.yml workflow reruns this nightly after data sync.

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';

  const yearParam = request.nextUrl.searchParams.get('year');
  let years = [...AVAILABLE_SEASONS];
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

  const scopeParam = request.nextUrl.searchParams.get('scope');
  let scopes = allLevelScopes();
  if (scopeParam) {
    const parsed = parseScopeKey(scopeParam);
    if (parsed.length === 0) {
      return NextResponse.json(
        { ok: false, error: `Unknown scope "${scopeParam}". Use atp, challenger, itf joined by +.` },
        { status: 400 }
      );
    }
    scopes = [parsed];
  }

  try {
    const results = [];
    for (const year of years) {
      const summary = await recomputeSwingsForYear(pool, year, { persist: !dryRun, scopes });
      results.push({
        year,
        totalEventCount: summary.totalEventCount,
        persisted: summary.persisted,
        scopes: summary.scopes.map((s) => ({
          scope: scopeKey(s.scope),
          eventCount: s.eventCount,
          swingCount: s.swings.length,
          swings: s.swings.map(describeSwing),
        })),
      });
    }

    return NextResponse.json({ ok: true, dryRun, results });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

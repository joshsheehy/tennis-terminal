import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { AVAILABLE_SEASONS, isAvailableSeason } from '@/lib/seasons';
import { describeSwing, recomputeSwingsForYear } from '@/lib/swings-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Swing detection (phase 2): chains of tournaments in consecutive weeks that
// are close enough to play back-to-back (ATP + Challenger only). Detection is
// pure computation over tournament_editions + coordinates; persistence only
// touches the additive swings/swing_events tables.
//
// ?dryRun=false persists (delete + reinsert per year); the default just
// computes and returns the swing list for review.
// ?year=2026 limits to one season (default: all available seasons).
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

  try {
    const results = [];
    for (const year of years) {
      const summary = await recomputeSwingsForYear(pool, year, { persist: !dryRun });
      results.push({
        year,
        eventCount: summary.eventCount,
        swingCount: summary.swings.length,
        persisted: summary.persisted,
        swings: summary.swings.map(describeSwing),
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

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { CONDITIONS_CACHE_TAG, climateTargets, fetchClimate, saveClimate } from '@/lib/edition-conditions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: fill the usual weather and elevation for upcoming editions from
// Open-Meteo. Time-budgeted so one call never hits the request timeout; the
// caller repeats while hasMore is true (.github/workflows/conditions-sync.yml).
//
//   POST /api/conditions/climate?weeks=8&budgetMs=40000

const PAUSE_MS = 1500; // between editions: six small Open-Meteo calls each

export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const weeks = Math.min(26, Math.max(1, Number(params.get('weeks') ?? 8)));
  const budgetMs = Math.min(55_000, Math.max(5_000, Number(params.get('budgetMs') ?? 40_000)));
  const deadline = Date.now() + budgetMs;

  const targets = await climateTargets(weeks);
  const saved: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const target of targets) {
    if (Date.now() > deadline) break;
    try {
      const { climate, elevation } = await fetchClimate(target);
      await saveClimate(target.editionId, climate, elevation);
      saved.push(`${target.startDate} ${target.name}`);
    } catch (error) {
      failed.push({ name: target.name, error: error instanceof Error ? error.message : String(error) });
      // Open-Meteo answers 429 when the minute's budget is spent; stop rather than fail every row.
      if (String(error).includes(' 429 ')) break;
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  if (saved.length) revalidateTag(CONDITIONS_CACHE_TAG);

  const remaining = targets.length - saved.length;
  return NextResponse.json({
    ok: true,
    weeks,
    saved: saved.length,
    failed,
    remaining,
    hasMore: remaining > 0 && failed.length === 0,
    sample: saved.slice(0, 10),
  });
}

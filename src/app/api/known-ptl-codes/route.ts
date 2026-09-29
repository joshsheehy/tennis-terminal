import { NextRequest, NextResponse } from 'next/server';
import { getKnownCodesForYear } from '@/lib/ptl-known-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The flat list of ProTennisLive codes already tied to a tournament for a
// season — read-only, no upstream requests. scan-ptl-season.mjs fetches this
// before probing a range so a rescan doesn't re-spend protennislive.com's
// rate-limited budget on codes we've already found; see that script's
// --skip-codes-file.
//
//   GET /api/known-ptl-codes?year=2026
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year)) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }
  const codes = (await getKnownCodesForYear(year)).sort((a, b) => a - b);
  return NextResponse.json({ ok: true, year, count: codes.length, codes });
}

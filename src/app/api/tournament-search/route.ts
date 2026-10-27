import { NextRequest, NextResponse } from 'next/server';
import { searchTournamentEditions } from '@/lib/tournament-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): read-only search over
// the same public schedule the site already shows, for the Saved page's
// "Add tournament" picker. GET ?q=<name or city>.
export async function GET(request: NextRequest) {
  try {
    const results = await searchTournamentEditions(request.nextUrl.searchParams.get('q'));
    return NextResponse.json({ ok: true, results }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[tournament-search] failed', err);
    return NextResponse.json({ ok: false, error: 'Search failed. Please try again.' }, { status: 500 });
  }
}

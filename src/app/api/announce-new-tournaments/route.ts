import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/brand';
import { newTournamentMessage } from '@/lib/new-tournament-message';
import { hasAnnouncedBefore, markAnnounced, recordBaseline, unannouncedTournaments } from '@/lib/tournament-announcements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: ATP/Challenger tournaments that have just appeared on the site,
// whichever importer added them, for .github/workflows/tournament-alerts.yml
// to Telegram. The Telegram bot token lives in GitHub's secrets, not
// Railway's, so this only prepares the message; the workflow sends it and
// then confirms, and only confirmed editions are recorded — a failed send is
// retried on the next run rather than lost.
//
//   POST /api/announce-new-tournaments              -> { count, message, editionIds }
//   POST /api/announce-new-tournaments?confirm=1    <- { editionIds } once sent
//
// The first call ever records everything already listed and returns nothing
// to send.

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('confirm') === '1') {
    const body = (await request.json().catch(() => null)) as { editionIds?: unknown } | null;
    const ids = Array.isArray(body?.editionIds) ? body.editionIds.filter((id): id is string => typeof id === 'string') : [];
    await markAnnounced(ids);
    return NextResponse.json({ ok: true, recorded: ids.length });
  }

  if (!(await hasAnnouncedBefore())) {
    const recorded = await recordBaseline();
    return NextResponse.json({ ok: true, baseline: true, recorded, count: 0, message: null, editionIds: [] });
  }

  const fresh = await unannouncedTournaments();
  return NextResponse.json({
    ok: true,
    count: fresh.length,
    tournaments: fresh.map((t) => `${t.startDate} ${t.level} ${t.name}`),
    message: fresh.length ? newTournamentMessage(fresh, SITE_URL) : null,
    editionIds: fresh.map((t) => t.editionId),
  });
}

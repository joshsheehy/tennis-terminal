import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/brand';
import { newTournamentMessage } from '@/lib/new-tournament-message';
import { hasAnnouncedBefore, markAnnounced, recordBaseline, unannouncedTournaments } from '@/lib/tournament-announcements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: Telegram the owner about ATP/Challenger tournaments that have just
// appeared on the site, whichever importer added them. Run by
// .github/workflows/tournament-alerts.yml every few hours.
//
//   POST /api/announce-new-tournaments            send + record
//   POST /api/announce-new-tournaments?dryRun=1   list only
//
// The first run records everything already listed and sends nothing.
// An edition is only recorded once Telegram has accepted the message, so a
// failed send is retried next run rather than lost.

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `Telegram ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

export async function POST(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';

  if (!(await hasAnnouncedBefore())) {
    if (dryRun) return NextResponse.json({ ok: true, dryRun, baseline: 'would record every listed tournament' });
    const recorded = await recordBaseline();
    return NextResponse.json({ ok: true, baseline: true, recorded, message: 'First run: existing tournaments recorded, nothing sent.' });
  }

  const fresh = await unannouncedTournaments();
  const summary = fresh.map((t) => `${t.startDate} ${t.level} ${t.name}`);
  if (fresh.length === 0 || dryRun) return NextResponse.json({ ok: true, dryRun, count: fresh.length, tournaments: summary });

  const sent = await sendTelegram(newTournamentMessage(fresh, SITE_URL));
  if (!sent.ok) return NextResponse.json({ ok: false, error: sent.error, count: fresh.length }, { status: 502 });
  await markAnnounced(fresh.map((t) => t.editionId));
  return NextResponse.json({ ok: true, announced: fresh.length, tournaments: summary });
}

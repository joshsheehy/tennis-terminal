import { NextRequest, NextResponse } from 'next/server';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON } from '@/lib/seasons';
import {
  Category,
  Deadline,
  deadlineKey,
  dueDeadlines,
  normalizeCategoriesFromParam,
} from '@/lib/entry-deadlines';
import { renderDigest } from '@/lib/alert-email';
import { emailConfigured, sendEmail } from '@/lib/email';
import {
  claimSend,
  listActiveSubscribers,
  releaseSend,
} from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin/cron endpoint (behind the middleware admin-secret gate). Emails each
// active subscriber ~24 hours before every entry deadline in the categories
// they chose. Idempotent: alert_sends dedupes per (subscriber, deadline), so
// running it every night never double-emails.
//
//   ?lead=N     lead time in days (default 1 = "24 hours before")
//   ?dry=1      compute + report, but send nothing and record nothing
//   ?test=EMAIL send the current window to one address (ignores subscriber list
//               and dedupe log). Combine with ?cats=atp,itf to pick categories.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lead = Math.max(0, Math.min(30, Number(params.get('lead') ?? '1') || 1));
  const dry = params.get('dry') === '1';
  const testEmail = params.get('test');
  const origin = request.nextUrl.origin;
  const today = new Date();

  // Deadlines for tournaments in early next season fall in the prior calendar
  // year (a 42-day GS deadline can be ~6 weeks before a January event), so pull
  // both years.
  const [thisYear, nextYear] = await Promise.all([
    getScheduleForYear(CURRENT_SEASON),
    getScheduleForYear(CURRENT_SEASON + 1).catch(() => []),
  ]);
  const schedule = [...thisYear, ...nextYear];

  if (!emailConfigured() && !dry) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'RESEND_API_KEY is not set — cannot send. Set it on the server, or call with ?dry=1 to preview.',
        leadDays: lead,
      },
      { status: 503 }
    );
  }

  // Test mode: send the current window to a single address for the chosen
  // categories (default: all).
  if (testEmail) {
    const cats = normalizeCategoriesFromParam(params.get('cats'));
    const deadlines = dueDeadlines(schedule, today, { leadDays: lead, categories: cats });
    if (deadlines.length === 0) {
      return NextResponse.json({
        ok: true,
        test: testEmail,
        sent: false,
        leadDays: lead,
        categories: cats,
        reason: `No deadlines due within ${lead} day(s) for [${cats.join(', ')}].`,
      });
    }
    const { subject, html, text } = renderDigest(deadlines, origin, 'preview-token');
    const result = dry
      ? { ok: true, id: 'dry-run' }
      : await sendEmail({ to: testEmail, subject, html, text });
    return NextResponse.json({
      ok: result.ok,
      test: testEmail,
      dry,
      leadDays: lead,
      categories: cats,
      deadlinesFound: deadlines.length,
      deadlines: deadlines.map(summarize),
      sendResult: result,
    });
  }

  const subscribers = await listActiveSubscribers();
  const perSubscriber: Array<{
    email: string;
    categories: Category[];
    newDeadlines: number;
    sent: boolean;
    error?: string;
  }> = [];
  let totalDeadlineHits = 0;

  for (const sub of subscribers) {
    const deadlines = dueDeadlines(schedule, today, {
      leadDays: lead,
      categories: sub.categories,
    });
    totalDeadlineHits += deadlines.length;

    // Claim each deadline for this subscriber; we "win" only the ones not yet
    // sent. Claiming before the send keeps concurrent runs from double-sending.
    const won: Deadline[] = [];
    for (const d of deadlines) {
      const claimed = dry ? true : await claimSend(sub.id, deadlineKey(d));
      if (claimed) won.push(d);
    }

    if (won.length === 0) {
      perSubscriber.push({
        email: sub.email,
        categories: sub.categories,
        newDeadlines: 0,
        sent: false,
      });
      continue;
    }

    if (dry) {
      perSubscriber.push({
        email: sub.email,
        categories: sub.categories,
        newDeadlines: won.length,
        sent: false,
      });
      continue;
    }

    const { subject, html, text } = renderDigest(won, origin, sub.unsubscribe_token);
    const result = await sendEmail({ to: sub.email, subject, html, text });
    if (!result.ok) {
      // Release claims so the next run retries instead of silently skipping.
      await Promise.all(won.map((d) => releaseSend(sub.id, deadlineKey(d))));
    }
    perSubscriber.push({
      email: sub.email,
      categories: sub.categories,
      newDeadlines: won.length,
      sent: result.ok,
      error: result.ok ? undefined : result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    dry,
    ranAt: new Date().toISOString(),
    leadDays: lead,
    subscribers: subscribers.length,
    deadlineHits: totalDeadlineHits,
    emailsSent: perSubscriber.filter((s) => s.sent).length,
    perSubscriber,
  });
}

function summarize(d: Deadline) {
  return {
    tournament: d.name,
    level: d.level,
    kind: d.kind,
    deadlineDate: d.deadlineDate,
    tournamentStart: d.tournamentStart,
  };
}


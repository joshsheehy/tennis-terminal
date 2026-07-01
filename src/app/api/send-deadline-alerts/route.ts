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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Build the subject + HTML + plain-text digest for a set of deadlines.
function renderDigest(deadlines: Deadline[], origin: string, unsubToken: string) {
  const count = deadlines.length;
  const soonest = deadlines[0];
  const subject =
    count === 1
      ? `Entry deadline tomorrow: ${soonest.name} (${soonest.kindLabel})`
      : `${count} entry deadlines coming up`;

  const rows = deadlines
    .map(
      (d) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">
          <strong>${esc(d.name)}</strong><br>
          <span style="color:#666;font-size:13px">${esc(d.level)} · ${esc(d.city)}${
            d.country ? ', ' + esc(d.country) : ''
          } · starts ${formatDate(d.tournamentStart)}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap">
          ${esc(d.kindLabel)}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap">
          <strong>${formatDate(d.deadlineDate)}</strong><br>
          <span style="color:#666;font-size:13px">${esc(d.timeNote)}</span>
        </td>
      </tr>`
    )
    .join('');

  const unsubUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f8;font-family:system-ui,-apple-system,sans-serif;color:#111">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:18px;margin:0 0 4px">Entry deadlines</h1>
    <p style="color:#555;font-size:14px;margin:0 0 16px">
      ${count === 1 ? 'A deadline is' : count + ' deadlines are'} due within about 24 hours. Times are shown per the governing body.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;font-size:14px">
      <thead>
        <tr style="background:#fafafa;text-align:left">
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase">Tournament</th>
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase">Draw</th>
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase">Deadline</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin:20px 0 0">
      You're receiving this because you signed up for Tennis Terminal alerts.
      <a href="${unsubUrl}" style="color:#999">Unsubscribe</a>.
    </p>
  </div>
</body></html>`;

  const text =
    `Entry deadlines due within ~24 hours:\n\n` +
    deadlines
      .map(
        (d) =>
          `- ${d.name} (${d.level}) — ${d.kindLabel}: ${formatDate(d.deadlineDate)} ${d.timeNote}. Tournament starts ${formatDate(d.tournamentStart)}.`
      )
      .join('\n') +
    `\n\nUnsubscribe: ${unsubUrl}`;

  return { subject, html, text };
}

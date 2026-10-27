import { NextRequest, NextResponse } from 'next/server';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON } from '@/lib/seasons';
import {
  Category,
  DueReminder,
  dueReminderDeadlines,
  normalizeCategoriesFromParam,
  normalizeReminderHours,
  reminderKey,
} from '@/lib/entry-deadlines';
import { renderDigest, unsubscribeUrl } from '@/lib/alert-email';
import { emailConfigured, listUnsubscribeHeaders, sendEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/brand';
import {
  claimSend,
  listActiveSubscribers,
  releaseSend,
} from '@/lib/subscribers';
import { ApnsClient, apnsConfigured } from '@/lib/apns';
import { deadlinePushMessage, pushReminderKey } from '@/lib/push-alerts';
import { deleteDeviceToken, listPushTargets, rememberDeviceEnv } from '@/lib/push-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin/cron endpoint (behind the middleware admin-secret gate). Runs hourly:
// each active subscriber picked reminder windows (24 / 12 / 1 hours before a
// deadline), and each window fires once per (subscriber, deadline) — the
// alert_sends log dedupes per window, so hourly runs never double-email.
// Deadline moments are real timestamps: 12:00 noon ET for ATP/Challenger/
// Grand Slam, 14:00 GMT for ITF.
//
//   ?dry=1        compute + report, but send nothing and record nothing
//   ?test=EMAIL   send the current window to one address (ignores subscriber
//                 list and dedupe log). Combine with ?cats=atp,itf, ?dbl=1 for
//                 doubles, and ?windows=24,12,1 to pick reminder windows.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dry = params.get('dry') === '1';
  const testEmail = params.get('test');
  // Always use the canonical public URL in emails, never the Railway host.
  const origin = SITE_URL;
  const now = new Date();

  // Deadlines for tournaments in early next season fall in the prior calendar
  // year (a 42-day GS deadline can be ~6 weeks before a January event), so pull
  // both years.
  const [thisYear, nextYear] = await Promise.all([
    getScheduleForYear(CURRENT_SEASON),
    getScheduleForYear(CURRENT_SEASON + 1).catch(() => []),
  ]);
  const schedule = [...thisYear, ...nextYear];

  // Email and push are independent: a missing Resend key must not stop push,
  // and missing APNs settings must not stop email. A missing Resend key still
  // fails the run (503) at the end — a silent green check once hid weeks of
  // unsent alerts — but only after push has had its turn.
  const emailReady = emailConfigured();
  const emailMissing = {
    ok: false,
    error: 'RESEND_API_KEY is not set — cannot send. Set it on the server, or call with ?dry=1 to preview.',
  };

  // Test mode: send whatever is currently inside the chosen windows to a single
  // address for the chosen categories (defaults: all categories, all windows).
  // Add &dbl=1 to include doubles advance entry.
  if (testEmail) {
    if (!emailReady && !dry) return NextResponse.json(emailMissing, { status: 503 });
    const cats = normalizeCategoriesFromParam(params.get('cats'));
    const includeDoubles = params.get('dbl') === '1';
    const windows = normalizeReminderHours(
      (params.get('windows') ?? '24,12,1').split(',').map(Number)
    );
    const deadlines = dueReminderDeadlines(schedule, now, {
      windows,
      categories: cats,
      includeDoubles,
    });
    if (deadlines.length === 0) {
      return NextResponse.json({
        ok: true,
        test: testEmail,
        sent: false,
        windows,
        categories: cats,
        reason: `No deadlines inside the ${windows.join('/')}h window(s) for [${cats.join(', ')}].`,
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
      windows,
      categories: cats,
      deadlinesFound: deadlines.length,
      deadlines: deadlines.map(summarize),
      sendResult: result,
    });
  }

  const subscribers = emailReady || dry ? await listActiveSubscribers() : [];
  const perSubscriber: Array<{
    email: string;
    categories: Category[];
    reminderHours: number[];
    newDeadlines: number;
    sent: boolean;
    error?: string;
  }> = [];
  let totalDeadlineHits = 0;

  for (const sub of subscribers) {
    const windows = normalizeReminderHours(sub.reminder_hours);
    const deadlines = dueReminderDeadlines(schedule, now, {
      windows,
      categories: sub.categories,
      includeDoubles: sub.include_doubles,
    });
    totalDeadlineHits += deadlines.length;

    // Claim every due (deadline, window) pair for this subscriber; a deadline
    // goes in the email if it won at least one previously-unsent window.
    // Claiming all currently-due windows at once means a subscriber who signs
    // up 3 hours out gets one email, not one per window. Claiming before the
    // send keeps concurrent runs from double-sending.
    const won: DueReminder[] = [];
    const wonKeys: string[] = [];
    for (const d of deadlines) {
      let winner = false;
      for (const w of d.dueWindows) {
        const key = reminderKey(d, w);
        const claimed = dry ? true : await claimSend(sub.id, key);
        if (claimed) {
          winner = true;
          wonKeys.push(key);
        }
      }
      if (winner) won.push(d);
    }

    if (won.length === 0) {
      perSubscriber.push({
        email: sub.email,
        categories: sub.categories,
        reminderHours: windows,
        newDeadlines: 0,
        sent: false,
      });
      continue;
    }

    if (dry) {
      perSubscriber.push({
        email: sub.email,
        categories: sub.categories,
        reminderHours: windows,
        newDeadlines: won.length,
        sent: false,
      });
      continue;
    }

    const { subject, html, text } = renderDigest(won, origin, sub.unsubscribe_token);
    const result = await sendEmail({
      to: sub.email,
      subject,
      html,
      text,
      headers: listUnsubscribeHeaders(unsubscribeUrl(origin, sub.unsubscribe_token)),
    });
    if (!result.ok) {
      // Release claims so the next run retries instead of silently skipping.
      await Promise.all(wonKeys.map((key) => releaseSend(sub.id, key)));
    }
    perSubscriber.push({
      email: sub.email,
      categories: sub.categories,
      reminderHours: windows,
      newDeadlines: won.length,
      sent: result.ok,
      error: result.ok ? undefined : result.error,
    });
  }

  // Push results stay out of perSubscriber on purpose: the workflow's check
  // fails the run for any perSubscriber entry with deadlines but sent=false.
  const push = await sendDeadlinePushes(schedule, now, dry);

  if (!emailReady && !dry) {
    return NextResponse.json({ ...emailMissing, push }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    dry,
    push,
    ranAt: now.toISOString(),
    subscribers: subscribers.length,
    deadlineHits: totalDeadlineHits,
    emailsSent: perSubscriber.filter((s) => s.sent).length,
    perSubscriber,
  });
}

function summarize(d: DueReminder) {
  return {
    tournament: d.name,
    level: d.level,
    kind: d.kind,
    deadlineAt: d.deadlineAtIso,
    hoursLeft: d.hoursLeft,
    dueWindows: d.dueWindows,
    tournamentStart: d.tournamentStart,
  };
}

type PushReport = {
  skipped?: string;
  targets: number;
  notified: number;
  failed: Array<{ email: string; reason: string }>;
  devicesRemoved: number;
};

// Same deadlines and windows as the email, per account with a registered
// device, claimed under push: keys so the two channels dedupe independently.
async function sendDeadlinePushes(
  schedule: Parameters<typeof dueReminderDeadlines>[0],
  now: Date,
  dry: boolean
): Promise<PushReport> {
  const report: PushReport = { targets: 0, notified: 0, failed: [], devicesRemoved: 0 };
  if (!apnsConfigured() && !dry) return { ...report, skipped: 'APNs is not configured (APNS_* env vars unset)' };

  let targets;
  try {
    targets = await listPushTargets();
  } catch (err) {
    return { ...report, skipped: `could not load push devices: ${err instanceof Error ? err.message : 'error'}` };
  }
  report.targets = targets.length;
  const client = dry ? null : new ApnsClient();
  try {
    for (const target of targets) {
      const due = dueReminderDeadlines(schedule, now, {
        windows: normalizeReminderHours(target.reminder_hours),
        categories: target.categories,
        includeDoubles: target.include_doubles,
      });
      const won: DueReminder[] = [];
      const wonKeys: string[] = [];
      for (const d of due) {
        let winner = false;
        for (const w of d.dueWindows) {
          const key = pushReminderKey(reminderKey(d, w));
          if (dry || (await claimSend(target.id, key))) {
            winner = true;
            wonKeys.push(key);
          }
        }
        if (winner) won.push(d);
      }
      const message = deadlinePushMessage(won);
      if (!message || !client) {
        if (message) report.notified += 1;
        continue;
      }

      let delivered = false;
      let lastReason = '';
      for (const device of target.devices) {
        const outcome = await client.send(device.token, message, device.env);
        if (outcome.ok) {
          delivered = true;
          if (outcome.env !== device.env) await rememberDeviceEnv(device.token, outcome.env);
        } else {
          lastReason = outcome.reason || `HTTP ${outcome.status}`;
          if (outcome.gone) {
            await deleteDeviceToken(device.token);
            report.devicesRemoved += 1;
          }
        }
      }
      if (delivered) {
        report.notified += 1;
      } else {
        // Nothing reached any device: release so the next run retries.
        await Promise.all(wonKeys.map((key) => releaseSend(target.id, key)));
        report.failed.push({ email: target.email, reason: lastReason });
      }
    }
  } finally {
    client?.close();
  }
  return report;
}

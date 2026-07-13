import { NextRequest, NextResponse } from 'next/server';
import { normalizeReminderHours } from '@/lib/entry-deadlines';
import { isValidEmail, parseSelection, upsertSubscriber } from '@/lib/subscribers';
import { renderWelcome, unsubscribeUrl } from '@/lib/alert-email';
import { listUnsubscribeHeaders, sendEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts) that the /alerts signup
// form posts to. Accepts JSON { email, categories: string[] } or a form-encoded
// body (categories as repeated fields).
export async function POST(request: NextRequest) {
  let email = '';
  let categoriesInput: unknown = [];
  let doublesFlag: unknown = undefined;
  let reminderInput: unknown = [];
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as {
        email?: string;
        categories?: unknown;
        doubles?: unknown;
        reminderHours?: unknown;
      };
      email = (body.email ?? '').toString();
      categoriesInput = body.categories ?? [];
      doublesFlag = body.doubles;
      reminderInput = body.reminderHours ?? [];
    } else {
      const form = await request.formData();
      email = (form.get('email') ?? '').toString();
      categoriesInput = form.getAll('categories');
      doublesFlag = form.get('doubles') === 'on' || undefined;
      reminderInput = form.getAll('reminderHours');
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  email = email.trim();
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: 'Please enter a valid email address.' },
      { status: 400 }
    );
  }

  const { categories, includeDoubles } = parseSelection(categoriesInput, doublesFlag);
  const reminderHours = normalizeReminderHours(reminderInput);

  try {
    const sub = await upsertSubscriber(email, categories, includeDoubles, reminderHours);

    // Single opt-in: send a welcome/confirmation immediately on first signup
    // (not on re-submits). Fire-and-forget — a mail hiccup must not fail the
    // signup itself, which is already saved.
    if (sub.created) {
      // Always use the canonical public URL in emails, never the Railway host.
      const origin = SITE_URL;
      const welcome = renderWelcome({
        origin,
        token: sub.unsubscribe_token,
        categories,
        includeDoubles,
      });
      sendEmail({
        to: sub.email,
        subject: welcome.subject,
        html: welcome.html,
        text: welcome.text,
        headers: listUnsubscribeHeaders(unsubscribeUrl(origin, sub.unsubscribe_token)),
      }).catch((err) => console.error('welcome email failed', err));
    }

    const windows = reminderHours.map((h) => (h === 1 ? '1 hour' : `${h} hours`)).join(', ');
    return NextResponse.json({
      ok: true,
      categories,
      includeDoubles,
      reminderHours,
      message: `You're signed up. We'll email you ${windows} before each entry deadline.`,
    });
  } catch (err) {
    console.error('subscribe failed', err);
    return NextResponse.json(
      { ok: false, error: 'Could not save your subscription. Please try again.' },
      { status: 500 }
    );
  }
}

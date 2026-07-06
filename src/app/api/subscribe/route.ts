import { NextRequest, NextResponse } from 'next/server';
import { isValidEmail, parseSelection, upsertSubscriber } from '@/lib/subscribers';
import { renderWelcome, unsubscribeUrl } from '@/lib/alert-email';
import { listUnsubscribeHeaders, sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts) that the /alerts signup
// form posts to. Accepts JSON { email, categories: string[] } or a form-encoded
// body (categories as repeated fields).
export async function POST(request: NextRequest) {
  let email = '';
  let categoriesInput: unknown = [];
  let doublesFlag: unknown = undefined;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as {
        email?: string;
        categories?: unknown;
        doubles?: unknown;
      };
      email = (body.email ?? '').toString();
      categoriesInput = body.categories ?? [];
      doublesFlag = body.doubles;
    } else {
      const form = await request.formData();
      email = (form.get('email') ?? '').toString();
      categoriesInput = form.getAll('categories');
      doublesFlag = form.get('doubles') === 'on' || undefined;
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

  try {
    const sub = await upsertSubscriber(email, categories, includeDoubles);

    // Single opt-in: send a welcome/confirmation immediately on first signup
    // (not on re-submits). Fire-and-forget — a mail hiccup must not fail the
    // signup itself, which is already saved.
    if (sub.created) {
      const origin = request.nextUrl.origin;
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

    return NextResponse.json({
      ok: true,
      categories,
      includeDoubles,
      message: "You're signed up. We'll email you 24 hours before each entry deadline.",
    });
  } catch (err) {
    console.error('subscribe failed', err);
    return NextResponse.json(
      { ok: false, error: 'Could not save your subscription. Please try again.' },
      { status: 500 }
    );
  }
}

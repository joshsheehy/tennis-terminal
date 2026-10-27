import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';
import { normalizeReminderHours } from '@/lib/entry-deadlines';
import { getAlertPrefsForEmail, parseSelection, saveAlertPrefsForEmail } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts), signed-in only: the
// app's Alerts settings for the account's email. One set of preferences
// drives both channels; `emailOn` switches only the email.
//   GET  -> { categories, includeDoubles, reminderHours, emailOn }
//   PUT  <- same shape
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const prefs = await getAlertPrefsForEmail(user.email);
  return NextResponse.json({ ok: true, ...prefs }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();

  let body: { categories?: unknown; includeDoubles?: unknown; reminderHours?: unknown; emailOn?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const { categories } = parseSelection(body.categories);
  const prefs = {
    categories,
    includeDoubles: body.includeDoubles === true,
    reminderHours: normalizeReminderHours(body.reminderHours),
    emailOn: body.emailOn === true,
  };
  await saveAlertPrefsForEmail(user.email, prefs);
  return NextResponse.json({ ok: true, ...prefs, exists: true }, { headers: NO_STORE });
}

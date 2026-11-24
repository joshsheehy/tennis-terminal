import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, rejectUnsafeWrite } from '@/lib/auth-request';
import { normalizeReminderHours } from '@/lib/entry-deadlines';
import { isApnsToken, saveStandaloneDevicePrefs } from '@/lib/push-devices';
import { parseSelection } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): the Alerts settings of
// a phone that has push on without an account. The token is the proof.
// Signed-in phones use /api/alerts/prefs instead.
//   PUT <- { token, categories, includeDoubles, reminderHours }
export async function PUT(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;

  let body: { token?: unknown; categories?: unknown; includeDoubles?: unknown; reminderHours?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!isApnsToken(body.token)) {
    return NextResponse.json({ ok: false, error: 'Not a valid device token.' }, { status: 400 });
  }
  const prefs = {
    categories: parseSelection(body.categories).categories,
    includeDoubles: body.includeDoubles === true,
    reminderHours: normalizeReminderHours(body.reminderHours),
  };
  if (!(await saveStandaloneDevicePrefs(body.token, prefs))) {
    return NextResponse.json(
      { ok: false, error: 'Push isn’t on for this phone. Turn it on again to save.' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, ...prefs }, { headers: NO_STORE });
}

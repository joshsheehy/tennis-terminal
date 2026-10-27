import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';
import { isApnsToken, registerDevice } from '@/lib/push-devices';
import { getAlertPrefsForEmail, saveAlertPrefsForEmail } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts), signed-in only: the iOS
// app posts its APNs token here after the user turns push on. Also called on
// each launch, so a rotated token replaces the old one. Body: { token }.
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();

  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!isApnsToken(token)) {
    return NextResponse.json({ ok: false, error: 'Not a valid device token.' }, { status: 400 });
  }

  await registerDevice(user.id, token);
  // Push follows the account's alert preferences; make sure there are some,
  // without turning email on for someone who never asked for it.
  const prefs = await getAlertPrefsForEmail(user.email);
  if (!prefs.exists) {
    await saveAlertPrefsForEmail(user.email, { ...prefs, emailOn: false });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

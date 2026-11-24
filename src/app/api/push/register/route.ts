import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, currentUser, rejectUnsafeWrite } from '@/lib/auth-request';
import { getDevice, isApnsToken, registerDevice, registerStandaloneDevice, replaceDeviceToken } from '@/lib/push-devices';
import { getAlertPrefsForEmail, saveAlertPrefsForEmail } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): the iOS app posts its
// APNs token here after the user turns push on, and again on each launch so a
// rotated token replaces the old one. Body: { token, previousToken? }.
//   Signed in  -> the phone joins the account and follows its preferences.
//   Signed out -> the phone gets pushes on its own; the response carries its
//                 preferences ({ standalone: true, categories, ... }).
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;

  let token: unknown;
  let previousToken: unknown;
  try {
    ({ token, previousToken } = (await request.json()) as { token?: unknown; previousToken?: unknown });
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!isApnsToken(token)) {
    return NextResponse.json({ ok: false, error: 'Not a valid device token.' }, { status: 400 });
  }
  if (isApnsToken(previousToken) && previousToken.toLowerCase() !== token.toLowerCase()) {
    await replaceDeviceToken(previousToken, token);
  }

  const user = await currentUser(request);
  if (!user) {
    const prefs = await registerStandaloneDevice(token);
    return NextResponse.json({ ok: true, standalone: true, ...prefs }, { headers: NO_STORE });
  }

  const before = await getDevice(token);
  await registerDevice(user.id, token);
  // Push follows the account's alert preferences; make sure there are some,
  // without turning email on for someone who never asked for it. A phone that
  // had push on while signed out brings its own choices along.
  const prefs = await getAlertPrefsForEmail(user.email);
  if (!prefs.exists) {
    const base = before && before.userId === null ? before.prefs : prefs;
    await saveAlertPrefsForEmail(user.email, { ...base, emailOn: false });
  }
  return NextResponse.json({ ok: true, standalone: false }, { headers: NO_STORE });
}

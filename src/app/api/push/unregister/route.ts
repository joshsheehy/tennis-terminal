import { NextRequest, NextResponse } from 'next/server';
import { currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';
import { isApnsToken, unregisterDevice } from '@/lib/push-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts), signed-in only: stop
// pushes to this phone — the user turned push off, or is signing out (so the
// phone stops getting the previous account's alerts). Body: { token }.
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
  await unregisterDevice(user.id, token);
  return NextResponse.json({ ok: true });
}

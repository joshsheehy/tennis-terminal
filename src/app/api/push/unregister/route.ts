import { NextRequest, NextResponse } from 'next/server';
import { currentUser, rejectUnsafeWrite } from '@/lib/auth-request';
import { deleteDeviceToken, isApnsToken, unregisterDevice } from '@/lib/push-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): stop pushes to this
// phone (the user turned push off, or deleted their account). Signed out, the
// token itself is the proof: only this app install has it. Body: { token }.
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;

  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!isApnsToken(token)) {
    return NextResponse.json({ ok: false, error: 'Not a valid device token.' }, { status: 400 });
  }
  const user = await currentUser(request);
  if (user) await unregisterDevice(user.id, token);
  else await deleteDeviceToken(token);
  return NextResponse.json({ ok: true });
}

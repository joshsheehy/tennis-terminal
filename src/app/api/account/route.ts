import { NextRequest, NextResponse } from 'next/server';
import { deleteUser } from '@/lib/accounts';
import { clearSessionCookie, currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): permanently deletes the
// signed-in account, its sessions and saved tournaments. Apple requires
// in-app account deletion for any app that offers sign-up (Guideline 5.1.1(v)).
export async function DELETE(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();
  await deleteUser(user.id);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}

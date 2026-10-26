import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/accounts';
import { clearSessionCookie, rejectUnsafeWrite, requestSessionToken } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): ends the current session.
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  await deleteSession(requestSessionToken(request));
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}

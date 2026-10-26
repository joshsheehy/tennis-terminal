import { NextRequest, NextResponse } from 'next/server';
import { verifyLoginCode } from '@/lib/accounts';
import { normalizeCode, normalizeEmail } from '@/lib/auth-core';
import { NO_STORE, rejectUnsafeWrite, setSessionCookie } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REASONS = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many wrong tries. Request a new code.',
} as const;

// Public endpoint (allow-listed in src/middleware.ts): trades an emailed code
// for a session. The web gets an HttpOnly cookie; the token is also returned
// in the body for the native app, which sends it back as a Bearer header.
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;

  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  if (!email || !code) {
    return NextResponse.json({ ok: false, error: 'Enter the 6-digit code from the email.' }, { status: 400 });
  }

  try {
    const result = await verifyLoginCode(email, code);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: REASONS[result.reason] }, { status: 400 });
    }
    const response = NextResponse.json(
      { ok: true, user: { email: result.user.email }, token: result.token },
      { headers: NO_STORE }
    );
    setSessionCookie(response, result.token);
    return response;
  } catch (err) {
    console.error('[auth] verify failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

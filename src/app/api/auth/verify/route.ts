import { NextRequest, NextResponse } from 'next/server';
import { openReviewSession, verifyLoginCode } from '@/lib/accounts';
import { normalizeCode, normalizeEmail, reviewLoginCheck } from '@/lib/auth-core';
import { NO_STORE, rejectUnsafeWrite, setSessionCookie } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REASONS = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many wrong tries. Request a new code.',
} as const;

// Wrong codes for the review account lock it for an hour after a few tries,
// so its fixed code can't be guessed. Per server instance, which is enough
// for one Railway service.
const REVIEW_MAX_MISSES = 8;
const REVIEW_LOCK_MS = 60 * 60 * 1000;
let reviewMisses: number[] = [];

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
    const review = reviewLoginCheck(email, code, process.env);
    if (review !== 'not-review') {
      const now = Date.now();
      reviewMisses = reviewMisses.filter((at) => now - at < REVIEW_LOCK_MS);
      if (reviewMisses.length >= REVIEW_MAX_MISSES) {
        return NextResponse.json({ ok: false, error: REASONS.too_many_attempts }, { status: 400 });
      }
      if (review === 'bad-code') {
        reviewMisses.push(now);
        return NextResponse.json({ ok: false, error: REASONS.invalid }, { status: 400 });
      }
      const session = await openReviewSession(email);
      const response = NextResponse.json(
        { ok: true, user: { email: session.user.email }, token: session.token },
        { headers: NO_STORE }
      );
      setSessionCookie(response, session.token);
      return response;
    }

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

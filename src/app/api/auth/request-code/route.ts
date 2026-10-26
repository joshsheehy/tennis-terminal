import { NextRequest, NextResponse } from 'next/server';
import { issueLoginCode } from '@/lib/accounts';
import { LOGIN_CODE_TTL_MINUTES, normalizeEmail } from '@/lib/auth-core';
import { clientIp, rejectUnsafeWrite } from '@/lib/auth-request';
import { renderLoginCodeEmail } from '@/lib/login-email';
import { emailConfigured, sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): emails a 6-digit
// sign-in code. Rate-limited per address and per IP inside issueLoginCode.
export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const isDev = process.env.NODE_ENV === 'development';
  if (!emailConfigured() && !isDev) {
    console.error('[auth] request-code: RESEND_API_KEY is not set, cannot send sign-in codes');
    return NextResponse.json(
      { ok: false, error: "Sign-in email isn't available right now. Please try again later." },
      { status: 503 }
    );
  }

  try {
    const issued = await issueLoginCode(email, clientIp(request));
    if (!issued.ok) {
      return NextResponse.json(
        { ok: false, error: 'Too many codes requested. Wait a bit and try again.' },
        { status: 429 }
      );
    }

    if (isDev) console.log(`[auth] dev sign-in code for ${email}: ${issued.code}`);
    if (emailConfigured()) {
      const sent = await sendEmail({ to: email, ...renderLoginCodeEmail(issued.code, LOGIN_CODE_TTL_MINUTES) });
      if (!sent.ok) {
        // Most likely ALERT_FROM_EMAIL isn't on a verified Resend domain, which
        // only allows mail to the Resend account owner's own address.
        console.error(`[auth] request-code: send failed: ${sent.error}`);
        return NextResponse.json(
          { ok: false, error: "We couldn't send the code. Please try again in a minute." },
          { status: 502 }
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[auth] request-code failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

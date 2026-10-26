import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getUserBySessionToken, type User } from './accounts';
import { SESSION_COOKIE, SESSION_TTL_DAYS, originAllowed, sessionTokenFrom } from './auth-core';
import { SITE_URL } from './brand';

// Session plumbing shared by the account API routes and server pages.
// Sessions are checked here, inside the Node runtime — middleware.ts runs on
// the edge and can't reach Postgres, so it only lists these routes as public.

export function requestSessionToken(request: NextRequest): string | null {
  return sessionTokenFrom(request.headers.get('authorization'), request.cookies.get(SESSION_COOKIE)?.value);
}

export function currentUser(request: NextRequest): Promise<User | null> {
  return getUserBySessionToken(requestSessionToken(request));
}

// For server components (the account page) — reads the cookie only.
export async function currentUserFromCookies(): Promise<User | null> {
  const store = await cookies();
  return getUserBySessionToken(store.get(SESSION_COOKIE)?.value ?? null);
}

export function clientIp(request: NextRequest): string | null {
  // Railway's proxy puts the original client first.
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || null;
}

// Gate for every write: JSON body only (an HTML form can't send one
// cross-site without a CORS preflight), and an Origin, when present, must be
// this site — unless the caller authenticates with a Bearer token, which a
// browser never attaches by itself. Returns an error response, or null to go on.
export function rejectUnsafeWrite(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'Send a JSON body.' }, { status: 415 });
  }
  const hasBearer = request.headers.get('authorization')?.toLowerCase().startsWith('bearer ');
  if (!hasBearer) {
    const hosts = [
      request.headers.get('host'),
      request.headers.get('x-forwarded-host'),
      new URL(SITE_URL).host,
      request.nextUrl.host,
    ];
    if (!originAllowed(request.headers.get('origin'), hosts)) {
      return NextResponse.json({ ok: false, error: 'Cross-site request blocked.' }, { status: 403 });
    }
  }
  return null;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
}

// Account responses are per-user; keep them out of every shared cache.
export const NO_STORE = { 'cache-control': 'private, no-store' };

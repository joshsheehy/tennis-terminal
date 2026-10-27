import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Pure helpers for email-code login. Kept free of any database import (db.ts
// throws without DATABASE_URL) so they stay unit-testable on their own; the
// table work lives in accounts.ts.

export const SESSION_COOKIE = 'tc_session';
export const SESSION_TTL_DAYS = 90;
export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
// Codes that can be requested per email / per IP in a rolling hour. The
// request endpoint is public and sends real email, so it must not be usable to
// spam an inbox or burn the Resend quota.
export const CODES_PER_EMAIL_PER_HOUR = 5;
export const CODES_PER_IP_PER_HOUR = 20;
// Upper bound on edition ids accepted in one save call (a whole season is
// well under this).
export const MAX_SAVED_PER_REQUEST = 100;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const code = String(raw).replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

// 32 random bytes, URL-safe. Only its hash is stored, so a database leak does
// not hand out live sessions.
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// A code is bound to the email it was sent to, so the same six digits issued
// to two people hash differently.
export function hashLoginCode(email: string, code: string): string {
  return sha256Hex(`${email}:${code}`);
}

export function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Keep only well-formed edition ids, deduped and capped. Malformed ids would
// otherwise make Postgres throw on the ::uuid cast.
export function parseEditionIds(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const ids = arr.map((v) => String(v).trim().toLowerCase()).filter(isUuid);
  return Array.from(new Set(ids)).slice(0, MAX_SAVED_PER_REQUEST);
}

// The token a request carries: an `Authorization: Bearer` header (the native
// app, which has no cookie jar shared with the site) or the session cookie.
export function sessionTokenFrom(authorization: string | null, cookieValue: string | undefined): string | null {
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return cookieValue || null;
}

// Only same-site relative paths survive as a post-login redirect target, so
// /login?next= can't bounce someone to another domain.
export function safeNextPath(next: unknown, fallback = '/account'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}

// Cross-site request check for cookie-authenticated writes. SameSite=Lax
// already blocks most of it; this closes the rest. Requests with no Origin
// (same-origin GETs, curl, native clients) pass. A bearer-token request is
// exempt because a browser never attaches that header on its own.
export function originAllowed(origin: string | null, allowedHosts: (string | null | undefined)[]): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((h) => typeof h === 'string' && h.toLowerCase() === host);
}

// App Store review sign-in. Apple's reviewers can't receive our emailed codes,
// so one dedicated address (REVIEW_LOGIN_EMAIL) accepts a fixed code
// (REVIEW_LOGIN_CODE) instead. Both must be set, and only that exact address
// is affected — every other sign-in still needs an emailed code.
export type ReviewCheck = 'not-review' | 'ok' | 'bad-code';

export function reviewLoginCheck(
  email: string,
  code: string | null,
  env: Record<string, string | undefined>
): ReviewCheck {
  const reviewEmail = normalizeEmail(env.REVIEW_LOGIN_EMAIL);
  const reviewCode = normalizeCode(env.REVIEW_LOGIN_CODE);
  if (!reviewEmail || !reviewCode || email !== reviewEmail) return 'not-review';
  if (!code) return 'bad-code';
  return hashesMatch(sha256Hex(code), sha256Hex(reviewCode)) ? 'ok' : 'bad-code';
}

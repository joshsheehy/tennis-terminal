import { NextRequest, NextResponse } from 'next/server';
import { unsubscribeByToken } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts). Reached from the
// unsubscribe link in every alert email: /api/unsubscribe?token=...
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const email = token ? await unsubscribeByToken(token) : null;

  const message = email
    ? `You've been unsubscribed (${email}). You will no longer receive entry-deadline alerts.`
    : 'This unsubscribe link is invalid or has already been used.';

  // Let a mistaken unsubscribe re-pick specific categories rather than losing
  // everything: the same token still opens their preferences page.
  const back = token
    ? `<a href="/alerts/manage?token=${encodeURIComponent(token)}">Change your preferences instead</a>`
    : `<a href="/alerts">Manage alerts</a>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Tennis Cuts alerts</h1><p>${message}</p><p>${back}</p></body></html>`;

  return new NextResponse(html, {
    status: email ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// One-click unsubscribe (RFC 8058). Mail clients POST to the List-Unsubscribe
// URL with body "List-Unsubscribe=One-Click"; the token stays in the query
// string. Just unsubscribe and return 200 — no page is rendered.
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (token) await unsubscribeByToken(token);
  return new NextResponse(null, { status: 200 });
}

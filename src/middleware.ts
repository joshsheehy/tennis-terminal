import { NextRequest, NextResponse } from 'next/server';

// Every /api route is an operator/sync tool that can read or mutate the
// production database, so they all require the admin secret. The only
// exceptions are the public coverage snapshot and the alert signup/unsubscribe
// endpoints, which are reached by anonymous visitors (form POST + email link).
const PUBLIC_API_PATHS = new Set(['/api/status', '/api/subscribe', '/api/unsubscribe']);

// The secret can be supplied three ways so both automation and a human in a
// browser address bar can authenticate:
//   - X-Admin-Secret: <secret>        (GitHub Actions workflows)
//   - Authorization: Bearer <secret>  (cron schedulers)
//   - ?key=<secret>                   (manual operator calls from the browser)
function suppliedSecret(request: NextRequest): string | null {
  const header = request.headers.get('x-admin-secret');
  if (header) return header;
  const bearer = request.headers.get('authorization');
  if (bearer?.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim();
  return request.nextUrl.searchParams.get('key');
}

export function middleware(request: NextRequest) {
  if (PUBLIC_API_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  // Local development stays friction-free; production fails closed below.
  if (process.env.NODE_ENV === 'development') return NextResponse.next();

  const validSecrets = [process.env.ADMIN_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  );

  if (validSecrets.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Admin API is locked: no ADMIN_SECRET is configured on the server. ' +
          'Set the ADMIN_SECRET environment variable, then pass it as an ' +
          'X-Admin-Secret header, an Authorization: Bearer token, or a ?key= query parameter.',
      },
      { status: 503 }
    );
  }

  const supplied = suppliedSecret(request);
  if (supplied && validSecrets.includes(supplied)) return NextResponse.next();

  return NextResponse.json(
    {
      ok: false,
      error:
        'Unauthorized. Pass the admin secret as an X-Admin-Secret header, ' +
        'an Authorization: Bearer token, or a ?key= query parameter.',
    },
    { status: 401 }
  );
}

export const config = {
  matcher: '/api/:path*',
};

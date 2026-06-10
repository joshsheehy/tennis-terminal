import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchJson(url: string) {
  // Forward the admin secret: the called routes sit behind the auth middleware.
  const secret = process.env.ADMIN_SECRET ?? process.env.CRON_SECRET ?? '';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisTerminalCron/1.0',
      'x-admin-secret': secret,
    },
    cache: 'no-store',
  });
  const text = await response.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: response.ok, status: response.status, json };
}

// Caller authentication happens in src/middleware.ts like every other admin route.
export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const year = new Date().getFullYear();

  const calendarResult = await fetchJson(`${baseUrl}/api/import-calendars`);
  if (!calendarResult.ok) {
    return NextResponse.json(
      { ok: false, step: 'import-calendars', result: calendarResult },
      { status: 500 }
    );
  }

  // Run current year and previous year — catches late PDF uploads from December events
  const [currentYear, previousYear] = await Promise.all([
    fetchJson(`${baseUrl}/api/import-cutoffs?year=${year}`),
    fetchJson(`${baseUrl}/api/import-cutoffs?year=${year - 1}`),
  ]);

  return NextResponse.json({
    ok: currentYear.ok,
    ranAt: new Date().toISOString(),
    year,
    calendarResult,
    currentYear,
    previousYear,
  });
}

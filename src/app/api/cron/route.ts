import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'TennisTerminalCron/1.0' },
    cache: 'no-store',
  });
  const text = await response.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: response.ok, status: response.status, json };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

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

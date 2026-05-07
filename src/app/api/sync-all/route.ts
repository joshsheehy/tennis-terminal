import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisTerminalSync/0.1',
    },
    cache: 'no-store',
  });

  const text = await response.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;

  const calendarImport = await fetchJson(`${baseUrl}/api/import-calendars`);

  if (!calendarImport.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: 'import-calendars',
        calendarImport,
      },
      { status: 500 }
    );
  }

  const cutoffImport = await fetchJson(`${baseUrl}/api/import-cutoffs`);

  return NextResponse.json(
    {
      ok: cutoffImport.ok,
      calendarImport,
      cutoffImport,
    },
    { status: cutoffImport.ok ? 200 : 500 }
  );
}

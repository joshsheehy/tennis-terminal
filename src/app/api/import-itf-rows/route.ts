import { NextRequest, NextResponse } from 'next/server';
import { upsertItfEvents, ITF_SOURCE, type ParsedItfEvent } from '@/lib/itf-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Receives ITF World Tennis Tour events fetched + parsed OFF-server.
// itftennis.com sits behind an Incapsula bot wall that blocks Railway's
// datacenter IPs but admits GitHub runners, so the itf-sync workflow fetches
// the calendar there and POSTs parsed events here for upserting.
//
//   POST /api/import-itf-rows?apply=true   { "year": 2026, "rows": [ParsedItfEvent...] }

const MAX_ROWS = 250;

function validateEvent(raw: unknown, year: number): { event?: ParsedItfEvent; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'row is not an object' };
  const r = raw as Record<string, unknown>;
  const slug = String(r.slug ?? '');
  const name = String(r.name ?? '').trim();
  const city = String(r.city ?? '').trim();
  const level = String(r.level ?? '');
  const start_date = String(r.start_date ?? '');
  const end_date = r.end_date == null ? null : String(r.end_date);
  const week = r.week == null ? null : Number(r.week);
  const source_url = r.source_url == null ? null : String(r.source_url);

  if (!slug.startsWith('itf-') || slug.length > 120) return { error: `bad slug "${slug}"` };
  if (!name) return { error: 'missing name' };
  if (!level.startsWith('ITF')) return { error: `bad level "${level}"` };
  if (Number(r.year) !== year) return { error: `row year ${r.year} != ${year}` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) return { error: `bad start_date "${start_date}"` };
  if (end_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return { error: `bad end_date "${end_date}"` };
  if (week !== null && (!Number.isInteger(week) || week < 1 || week > 53)) return { error: `bad week "${r.week}"` };
  if (source_url !== null && !/^https:\/\/www\.itftennis\.com\//.test(source_url)) return { error: 'source_url must be itftennis.com' };

  return {
    event: {
      slug,
      name,
      city: city || name,
      country: r.country == null ? null : String(r.country),
      year,
      week,
      start_date,
      end_date,
      level,
      surface: String(r.surface ?? 'Unknown'),
      indoor: Boolean(r.indoor),
      source_url,
    },
  };
}

export async function POST(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 });
  }
  const { year, rows } = body as { year?: unknown; rows?: unknown };
  if (!Number.isInteger(year) || (year as number) < 2024 || (year as number) > 2030) {
    return NextResponse.json({ ok: false, error: 'year must be an integer 2024-2030' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: `rows must be a non-empty array of <= ${MAX_ROWS}` }, { status: 400 });
  }

  const invalid: Array<{ index: number; error: string }> = [];
  const events: ParsedItfEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { event, error } = validateEvent(rows[i], year as number);
    if (event) events.push(event);
    else invalid.push({ index: i, error: error ?? 'invalid' });
  }

  const summary = apply && events.length > 0 ? await upsertItfEvents(events) : null;

  return NextResponse.json({
    ok: invalid.length === 0 && (summary?.errors.length ?? 0) === 0,
    apply,
    year,
    source: ITF_SOURCE,
    received: rows.length,
    validCount: events.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 10),
    upserted: summary,
    sample: events.slice(0, 3).map((e) => ({ slug: e.slug, level: e.level, week: e.week, start_date: e.start_date })),
    message: apply ? `Upserted ${summary?.upsertedEditions ?? 0} ITF editions.` : 'Dry run. Append ?apply=true to write.',
  });
}

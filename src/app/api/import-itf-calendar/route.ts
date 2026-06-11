import { NextRequest, NextResponse } from 'next/server';
import {
  fetchItfCalendarPage,
  isParseFailure,
  parseItfCalendarItem,
  upsertItfEvents,
  ITF_CIRCUITS,
  type ItfParseFailure,
  type ParsedItfEvent,
} from '@/lib/itf-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ITF World Tennis Tour calendar importer (additive: schedule rows only, no
// cuts — ITF entries are IPIN sign-in based, and every cut sweep/report in
// this app excludes level ILIKE 'ITF%').
//
// Usage:
//   GET /api/import-itf-calendar?year=2026               dry run, first pages
//   GET /api/import-itf-calendar?year=2026&apply=true    write to DB
//     &offset=N      resume ITF API pagination (response echoes nextOffset)
//     &circuit=men   men (MT, default) | women (WT)
//     &debug=true    include the first raw API item, for diagnosing
//                    field-name drift in the ITF response
//
// Paged + time-budgeted like the other importers; the data-sync workflow's
// run_paged helper consumes the hasMore/nextOffset contract.

const TIME_BUDGET_MS = 20000;
const PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? new Date().getFullYear());
  const circuit = params.get('circuit') ?? 'men';
  const apply = params.get('apply') === 'true';
  const debug = params.get('debug') === 'true';
  const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }
  const circuitCode = ITF_CIRCUITS[circuit];
  if (!circuitCode) {
    return NextResponse.json(
      { ok: false, error: `Unknown circuit "${circuit}" (use ${Object.keys(ITF_CIRCUITS).join('|')})` },
      { status: 400 }
    );
  }

  const startTime = Date.now();
  const parsed: ParsedItfEvent[] = [];
  const failures: ItfParseFailure[] = [];
  let firstRawItem: Record<string, unknown> | null = null;
  let totalItems: number | null = null;
  let skip = offset;
  let fetchedPages = 0;

  try {
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      const page = await fetchItfCalendarPage(year, circuitCode, skip, PAGE_SIZE);
      fetchedPages += 1;
      totalItems = page.totalItems ?? totalItems;
      if (firstRawItem === null && page.items.length > 0) firstRawItem = page.items[0];

      for (const item of page.items) {
        const result = parseItfCalendarItem(item, year);
        if (isParseFailure(result)) failures.push(result);
        else parsed.push(result);
      }

      skip += page.items.length;
      const exhausted =
        page.items.length === 0 || (totalItems !== null && skip >= totalItems);
      if (exhausted) break;
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        hint:
          'The ITF API may have changed shape or rejected the request. ' +
          'Re-run with &debug=true and share the sampleRawItem / error body.',
        year,
        circuit,
        offsetTried: skip,
      },
      { status: 502 }
    );
  }

  const upsertSummary = apply ? await upsertItfEvents(parsed) : null;

  const hasMore = totalItems !== null ? skip < totalItems : false;
  return NextResponse.json({
    ok: true,
    apply,
    year,
    circuit,
    totalItemsReported: totalItems,
    fetchedPages,
    parsedCount: parsed.length,
    skippedCount: failures.length,
    // Failures carry the reason + raw item; cap the echo so responses stay small.
    skipped: failures.slice(0, 10).map((f) => ({ reason: f.reason })),
    upserted: upsertSummary,
    hasMore,
    nextOffset: hasMore ? skip : null,
    sample: parsed.slice(0, 3),
    ...(debug ? { sampleRawItem: firstRawItem } : {}),
    message: apply
      ? `Imported ${upsertSummary?.upsertedEditions ?? 0} ITF editions for ${year}.`
      : 'Dry run. Append &apply=true to write.',
  });
}

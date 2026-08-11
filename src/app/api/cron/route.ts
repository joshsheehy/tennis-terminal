import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchJson(url: string) {
  // Forward the admin secret: the called routes sit behind the auth middleware.
  const secret = process.env.ADMIN_SECRET ?? process.env.CRON_SECRET ?? '';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisCutsCron/1.0',
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

  // 1. Sync the hand-curated catalogue from tournament-data.ts (names, PTL
  //    codes, surfaces) and run the stale-row sweep.
  const calendarResult = await fetchJson(`${baseUrl}/api/import-calendars`);
  if (!calendarResult.ok) {
    return NextResponse.json(
      { ok: false, step: 'import-calendars', result: calendarResult },
      { status: 500 }
    );
  }

  // 2. Discover NEW tournaments from the live official ATP Challenger calendar
  //    PDF and add them automatically. The calendar PDF is a "{year}-{year+1}"
  //    two-season document, so check both the current and next season to catch
  //    additions in either. Rows are upserted with source
  //    'atp_official_calendar_pdf', which import-calendars' stale sweep exempts,
  //    so a freshly-discovered event isn't immediately hidden again. apply
  //    (i.e. not apply=false) means write, not dry-run. Failures here are
  //    non-fatal — a flaky PDF fetch shouldn't abort the cut import below.
  const [officialCurrent, officialNext] = await Promise.all([
    fetchJson(`${baseUrl}/api/sync-official-calendar?year=${year}&apply=true`),
    fetchJson(`${baseUrl}/api/sync-official-calendar?year=${year + 1}&apply=true`),
  ]);

  // 3. Pull cut PDFs. Current year and previous year — catches late PDF uploads
  //    from December events.
  const [currentYear, previousYear] = await Promise.all([
    fetchJson(`${baseUrl}/api/import-cutoffs?year=${year}`),
    fetchJson(`${baseUrl}/api/import-cutoffs?year=${year - 1}`),
  ]);

  // 4. Backfill real singles draw sizes from JeffSackmann's match CSVs. These
  //    feed the acceptance-slot counts behind /depth, which otherwise fall back
  //    to per-level defaults that flatten the 56-vs-96 and 32-vs-48 splits.
  //    A season's file only fills in as matches are played, so the current year
  //    is re-run nightly and the previous year catches late corrections.
  //    Non-fatal: a flaky CSV fetch must not abort the cron.
  const [drawSizesCurrent, drawSizesPrevious] = await Promise.all([
    fetchJson(`${baseUrl}/api/import-draw-sizes?year=${year}&apply=true`),
    fetchJson(`${baseUrl}/api/import-draw-sizes?year=${year - 1}&apply=true`),
  ]);

  // New tournaments / fresh cuts won't show on the schedule until the cached
  // schedule query is invalidated.
  try {
    revalidateTag('schedule');
  } catch {
    // revalidateTag can throw outside the cache runtime; safe to swallow.
  }

  // Compact summary of any tournaments the official-calendar sweep just added,
  // so the cron response (and any log of it) shows what changed at a glance.
  const summarizeOfficial = (result: { ok: boolean; json: unknown }) => {
    const j = result.json as
      | {
          upsertedCount?: number;
          uniqueSeasonRowCount?: number;
          newlyAddedCount?: number;
          newlyAdded?: Array<{ slug?: string; name?: string; week?: number; level?: string }>;
        }
      | undefined;
    return {
      ok: result.ok,
      upsertedCount: j?.upsertedCount ?? 0,
      uniqueSeasonRowCount: j?.uniqueSeasonRowCount ?? 0,
      newlyAddedCount: j?.newlyAddedCount ?? 0,
      newlyAdded: (j?.newlyAdded ?? []).map((r) => ({ slug: r.slug, name: r.name, week: r.week, level: r.level })),
    };
  };

  return NextResponse.json({
    ok: currentYear.ok,
    ranAt: new Date().toISOString(),
    year,
    calendarResult,
    officialCalendar: {
      current: summarizeOfficial(officialCurrent),
      next: summarizeOfficial(officialNext),
    },
    currentYear,
    previousYear,
    drawSizes: {
      current: { ok: drawSizesCurrent.ok, ...(drawSizesCurrent.json as object) },
      previous: { ok: drawSizesPrevious.ok, ...(drawSizesPrevious.json as object) },
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mark a specific (slug, year) edition as not_held so it stops appearing on
// the schedule. Useful when an event is cancelled mid-season after the
// canonical entry was already imported (e.g. Durham 2026 Challenger 50,
// cancelled before play and dropped from the official calendar).
//
// Differs from sync-canonical's stale-row sweep in two ways:
//   1. Targets a specific (slug, year) instead of "everything not in
//      ALL_EDITIONS for year 2026", so it works for any year.
//   2. Does NOT skip rows with cuts attached. Cuts persist in the DB —
//      they're linked by tournament_edition_id and survive a status flip —
//      but a cancelled event shouldn't be hidden by the safeguard meant to
//      protect manually-imported PDF data on tournaments that still exist.
//
// Cuts can be brought back into view by /api/restore-historical-status which
// already restores any not_held row with cuts attached back to held.
//
// Usage:
//   GET /api/hide-edition?slug=durham-nc-durham&year=2026           — dry run
//   GET /api/hide-edition?slug=durham-nc-durham&year=2026&apply=true
//
// Slug match is exact. If you don't remember the exact slug, the dry-run
// response includes nothing if no row matched; pass ?fuzzy=true to match
// via ILIKE on slug or name and see what would be hit.

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const slug = sp.get('slug');
  const yearStr = sp.get('year');
  const apply = sp.get('apply') === 'true';
  const fuzzy = sp.get('fuzzy') === 'true';

  if (!slug || !yearStr) {
    return NextResponse.json(
      { ok: false, error: 'Required: slug, year. Optional: apply=true, fuzzy=true.' },
      { status: 400 }
    );
  }
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }

  const matchClause = fuzzy
    ? `(t.slug ilike $1 or t.name ilike $1 or t.city ilike $1)`
    : `t.slug = $1`;
  const matchValue = fuzzy ? `%${slug}%` : slug;

  const found = await pool.query<{
    edition_id: string;
    slug: string;
    name: string;
    year: number;
    level: string;
    status: string;
    cuts_count: string;
  }>(
    `select te.id as edition_id, t.slug, t.name, te.year, te.level, te.status,
            (select count(*) from cutoff_snapshots cs where cs.tournament_edition_id = te.id) as cuts_count
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.year = $2
       and ${matchClause}`,
    [matchValue, year]
  );

  if (found.rows.length === 0) {
    // Surface candidate rows so the operator can see what's actually in the
    // DB. First: any-year rows matching the (fuzzy) slug — tells us if the
    // tournament exists at all and which years it has editions for. Second:
    // any tournament whose slug shares a token with the request — catches
    // slug-spelling mismatches in the requested year.
    const tokenPattern = fuzzy ? matchValue : `%${slug.split('-').filter((t) => t.length > 2).join('%')}%`;
    const candidates = await pool.query<{
      slug: string;
      name: string;
      city: string;
      year: number;
      status: string;
    }>(
      `select distinct t.slug, t.name, t.city, te.year, te.status
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug ilike $1 or t.name ilike $1 or t.city ilike $1
       order by t.slug, te.year`,
      [tokenPattern]
    );

    return NextResponse.json(
      {
        ok: false,
        error: `No ${year} edition found for slug "${slug}"${fuzzy ? ' (fuzzy)' : ''}.`,
        searchedYear: year,
        searchedPattern: matchValue,
        candidatesAnyYear: candidates.rows,
        note: 'candidatesAnyYear shows what rows match the slug/name/city pattern across all years. If the tournament exists under a different slug, copy that slug and retry. If the row is missing entirely, the schedule may already be clean — confirm what year you were viewing on the site.',
      },
      { status: 404 }
    );
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      matches: found.rows.map((r) => ({
        editionId: r.edition_id,
        slug: r.slug,
        name: r.name,
        year: r.year,
        level: r.level,
        currentStatus: r.status,
        cutsCount: Number(r.cuts_count),
      })),
      note: 'Re-run with &apply=true to mark these editions not_held. Cuts attached stay in the DB but the row disappears from the schedule.',
    });
  }

  const updated = await pool.query<{ edition_id: string; slug: string; level: string }>(
    `update tournament_editions te
     set status = 'not_held', updated_at = now()
     from tournaments t
     where te.tournament_id = t.id
       and te.year = $2
       and ${matchClause}
       and te.status = 'held'
     returning te.id as edition_id, t.slug, te.level`,
    [matchValue, year]
  );

  // Bust the schedule cache so the home page reflects this hide immediately
  // instead of waiting up to 5 minutes for the unstable_cache window to
  // expire. Tag matches getCachedSchedule() in src/app/page.tsx.
  let cacheRevalidated = false;
  try {
    revalidateTag('schedule');
    cacheRevalidated = true;
  } catch {
    // revalidateTag can throw in dev/test environments without the cache
    // runtime; safe to swallow — DB write already happened.
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    hiddenCount: updated.rowCount ?? 0,
    hidden: updated.rows,
    cacheRevalidated,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Permanently delete a specific (slug, year) edition. Use when hide-edition
// alone isn't enough — e.g. Durham 2026 keeps reappearing because something
// upstream re-creates it with status='held' on every sync. Deleting the row
// removes any cuts attached too (cutoff_snapshots has ON DELETE CASCADE on
// tournament_edition_id).
//
// Differs from hide-edition: hide flips status to not_held (reversible,
// preserves cuts in DB). delete removes the row entirely (cuts go with it,
// not recoverable without re-import).
//
// Usage:
//   GET /api/delete-edition?slug=durham&year=2026                — dry run
//   GET /api/delete-edition?slug=durham&year=2026&apply=true
//   GET /api/delete-edition?slug=durham&year=2026&fuzzy=true     — slug/name/city ILIKE
//
// fuzzy=true is essential for catching importer slug variants (bare "durham"
// alongside the canonical "durham-nc-durham").

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
    return NextResponse.json(
      {
        ok: false,
        error: `No ${year} edition found for slug "${slug}"${fuzzy ? ' (fuzzy)' : ''}.`,
        note: 'Nothing to delete. If you saw the tournament on the schedule, hard-refresh — the page cache may be stale.',
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
      note: 'Re-run with &apply=true to DELETE these editions. Cuts attached will cascade-delete with the row. Irreversible.',
    });
  }

  const deleted = await pool.query<{ edition_id: string; slug: string; level: string }>(
    `delete from tournament_editions te
     using tournaments t
     where te.tournament_id = t.id
       and te.year = $2
       and ${matchClause}
     returning te.id as edition_id, t.slug, te.level`,
    [matchValue, year]
  );

  // Bust the schedule cache so the home page reflects this delete immediately.
  let cacheRevalidated = false;
  try {
    revalidateTag('schedule');
    cacheRevalidated = true;
  } catch {
    // Safe to swallow — DB write already happened.
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    deletedCount: deleted.rowCount ?? 0,
    deleted: deleted.rows,
    cacheRevalidated,
  });
}

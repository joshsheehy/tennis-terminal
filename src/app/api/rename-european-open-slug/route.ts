import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One-off rename: european-open-antwerp → european-open-brussels.
//
// The event has run in Brussels since 2023, so a URL slug that reads "antwerp"
// is misleading. This endpoint moves every edition (and the cuts attached to
// them via tournament_edition_id) from the old slug to a tournament row at the
// new slug, then deletes the old (now empty) row.
//
// Also cleans up the previously-hidden bnp-paribas-fortis-european-open-brussels
// row that sync-canonical's sweep marked not_held — that row was a duplicate
// from an older import with no cuts attached.
//
// Dry-run by default; pass ?apply=true to write.

const OLD_SLUG = 'european-open-antwerp';
const NEW_SLUG = 'european-open-brussels';
const DUPLICATE_SLUG = 'bnp-paribas-fortis-european-open-brussels';

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const oldRow = await pool.query<{ id: string; name: string; city: string }>(
    `select id, name, city from tournaments where slug = $1`,
    [OLD_SLUG]
  );

  const newRow = await pool.query<{ id: string }>(
    `select id from tournaments where slug = $1`,
    [NEW_SLUG]
  );

  const duplicateRow = await pool.query<{ id: string; edition_count: string; cuts_count: string }>(
    `select t.id,
            (select count(*) from tournament_editions te where te.tournament_id = t.id) as edition_count,
            (select count(*) from cutoff_snapshots cs
             join tournament_editions te on te.id = cs.tournament_edition_id
             where te.tournament_id = t.id) as cuts_count
     from tournaments t where t.slug = $1`,
    [DUPLICATE_SLUG]
  );

  const plan = {
    oldSlugExists: oldRow.rows.length > 0,
    newSlugAlreadyExists: newRow.rows.length > 0,
    duplicateSlugExists: duplicateRow.rows.length > 0,
    duplicateEditionCount: Number(duplicateRow.rows[0]?.edition_count ?? 0),
    duplicateCutsCount: Number(duplicateRow.rows[0]?.cuts_count ?? 0),
  };

  if (!plan.oldSlugExists) {
    return NextResponse.json({
      ok: true,
      noop: true,
      plan,
      note: `Nothing to do — no tournament at slug "${OLD_SLUG}".`,
    });
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      plan,
      note: `Re-run with ?apply=true to (1) drop the empty duplicate row at "${DUPLICATE_SLUG}" if present, then (2) rename "${OLD_SLUG}" → "${NEW_SLUG}".`,
    });
  }

  try {
    await pool.query('BEGIN');

    // Drop the previously-hidden duplicate slug ONLY if it has no cuts and no
    // editions worth keeping. If it does have cuts somehow, abort so the
    // operator can inspect.
    if (plan.duplicateSlugExists) {
      if (plan.duplicateCutsCount > 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          {
            ok: false,
            error: `Refused to drop "${DUPLICATE_SLUG}" — it has ${plan.duplicateCutsCount} cuts attached. Migrate those first.`,
            plan,
          },
          { status: 409 }
        );
      }
      await pool.query(
        `delete from tournament_editions where tournament_id = (select id from tournaments where slug = $1)`,
        [DUPLICATE_SLUG]
      );
      await pool.query(`delete from tournaments where slug = $1`, [DUPLICATE_SLUG]);
    }

    // If the new slug already happens to exist, refuse — operator needs to
    // resolve manually (this should not happen on a fresh run).
    if (plan.newSlugAlreadyExists) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        {
          ok: false,
          error: `New slug "${NEW_SLUG}" already exists. Resolve manually.`,
          plan,
        },
        { status: 409 }
      );
    }

    const renameResult = await pool.query(
      `update tournaments set slug = $2, updated_at = now() where slug = $1`,
      [OLD_SLUG, NEW_SLUG]
    );

    await pool.query('COMMIT');

    return NextResponse.json({
      ok: true,
      dryRun: false,
      plan,
      renamed: renameResult.rowCount ?? 0,
      droppedDuplicate: plan.duplicateSlugExists,
      note: `Tournament now lives at /tournaments/${NEW_SLUG}. Old URL /tournaments/${OLD_SLUG} will 404.`,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

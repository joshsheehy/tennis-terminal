import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { mergeTournaments } from '@/lib/merge-tournament';
import { TOURNAMENT_ALIASES } from '@/lib/tournament-aliases';
import { SURFACE_OVERRIDES } from '@/lib/surface-overrides';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Applies tournament-aliases.ts: any tournament sitting under a known
// duplicate slug gets merged into its canonical tournament. Safe to call
// every night — a slug with nothing under it is simply skipped, and a merge
// is the same idempotent operation /api/merge-tournaments exposes for a
// one-off run.
//
//   GET /api/resolve-tournament-aliases?apply=true

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const results: Array<{
    aliasSlug: string;
    canonicalSlug: string;
    found: boolean;
    merged?: boolean;
    movedEditions?: number;
    mergedConflictYears?: number;
  }> = [];

  for (const alias of TOURNAMENT_ALIASES) {
    const [ghostRow, canonicalRow] = await Promise.all([
      pool.query<{ id: string }>('select id from tournaments where slug = $1', [alias.aliasSlug]),
      pool.query<{ id: string }>('select id from tournaments where slug = $1', [alias.canonicalSlug]),
    ]);

    const ghost = ghostRow.rows[0];
    const canonical = canonicalRow.rows[0];

    if (!ghost) {
      results.push({ aliasSlug: alias.aliasSlug, canonicalSlug: alias.canonicalSlug, found: false });
      continue;
    }
    if (!canonical) {
      // The canonical row is the one thing this sweep must not create — if it
      // doesn't exist yet there is nothing safe to merge into.
      results.push({
        aliasSlug: alias.aliasSlug,
        canonicalSlug: alias.canonicalSlug,
        found: true,
        merged: false,
      });
      continue;
    }

    if (!apply) {
      results.push({ aliasSlug: alias.aliasSlug, canonicalSlug: alias.canonicalSlug, found: true });
      continue;
    }

    const summary = await mergeTournaments(ghost.id, canonical.id);
    results.push({
      aliasSlug: alias.aliasSlug,
      canonicalSlug: alias.canonicalSlug,
      found: true,
      merged: true,
      movedEditions: summary.movedEditions,
      mergedConflictYears: summary.mergedConflictYears,
    });
  }

  // Surface overrides (surface-overrides.ts): re-assert a known surface on every year of a tournament.
  const surfaceOverrides: Array<{ slug: string; surface: string; editions: number; years: number[] }> = [];
  for (const override of SURFACE_OVERRIDES) {
    const wrong = await pool.query<{ id: string; year: number }>(
      `select te.id, te.year
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1
         and (te.surface is distinct from $2 or te.indoor is distinct from $3)
       order by te.year`,
      [override.slug, override.surface, override.indoor]
    );
    if (apply && wrong.rows.length) {
      await pool.query(
        `update tournament_editions set surface = $1, indoor = $2, updated_at = now() where id = any($3::uuid[])`,
        [override.surface, override.indoor, wrong.rows.map((r) => r.id)]
      );
    }
    surfaceOverrides.push({
      slug: override.slug,
      surface: override.surface,
      editions: wrong.rows.length,
      years: wrong.rows.map((r) => r.year),
    });
  }

  return NextResponse.json({
    ok: true,
    apply,
    results,
    surfaceOverrides,
    note: apply
      ? undefined
      : 'Dry run: reports which aliases currently have a row to merge, and which editions a surface override would change. Re-run with &apply=true.',
  });
}

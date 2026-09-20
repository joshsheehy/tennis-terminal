import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { mergeTournaments } from '@/lib/merge-tournament';
import { TOURNAMENT_ALIASES } from '@/lib/tournament-aliases';

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

  return NextResponse.json({
    ok: true,
    apply,
    results,
    note: apply
      ? undefined
      : 'Dry run: reports which aliases currently have a row to merge. Re-run with &apply=true.',
  });
}

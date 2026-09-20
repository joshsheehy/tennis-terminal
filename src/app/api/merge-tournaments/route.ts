import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { mergeTournaments, resolveTournamentBySlugOrText } from '@/lib/merge-tournament';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manually merge one tournament ("from"/ghost) into another ("to"/canonical).
// For same-event duplicates that the automatic heuristics cannot match because
// their names/cities/weeks differ too much — e.g. "Istanbul TTF" and
// "İstanbul (İstinye)", which are the same Challenger.
//
// A duplicate that recurs from a specific data source (an importer keeps
// re-deriving the same alternate name/slug every night) needs more than a
// one-off run of this — see tournament-aliases.ts and
// /api/resolve-tournament-aliases, which apply the same merge nightly.
//
// Usage:
//   GET /api/merge-tournaments?from=<slug|name>&to=<slug|name>&apply=true
// Dry-run by default. Each of from/to must resolve to exactly one tournament.

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const fromQ = sp.get('from');
  const toQ = sp.get('to');
  const apply = sp.get('apply') === 'true';

  if (!fromQ || !toQ) {
    return NextResponse.json(
      { ok: false, error: 'Required: from, to (slug or name). Optional: apply=true (default dry-run).' },
      { status: 400 }
    );
  }

  const [fromMatches, toMatches] = await Promise.all([
    resolveTournamentBySlugOrText(fromQ),
    resolveTournamentBySlugOrText(toQ),
  ]);

  if (fromMatches.length !== 1 || toMatches.length !== 1) {
    return NextResponse.json(
      {
        ok: false,
        error: 'from and to must each resolve to exactly one tournament. Refine the query or pass exact slugs.',
        fromMatches,
        toMatches,
      },
      { status: 400 }
    );
  }

  const ghost = fromMatches[0];
  const canonical = toMatches[0];

  if (ghost.id === canonical.id) {
    return NextResponse.json({ ok: false, error: 'from and to resolve to the same tournament' }, { status: 400 });
  }

  if (!apply) {
    const ghostEditions = await pool.query<{ year: number }>(
      `select year from tournament_editions where tournament_id = $1 order by year`,
      [ghost.id]
    );
    return NextResponse.json({
      ok: true,
      dryRun: true,
      from: ghost,
      to: canonical,
      ghostEditionYears: ghostEditions.rows.map((r) => r.year),
      note: 'Re-run with &apply=true to move ghost editions into the canonical tournament and delete the ghost.',
    });
  }

  try {
    const summary = await mergeTournaments(ghost.id, canonical.id);
    return NextResponse.json({
      ok: true,
      dryRun: false,
      from: ghost.slug,
      to: canonical.slug,
      ...summary,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

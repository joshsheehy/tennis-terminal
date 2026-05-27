import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manually merge one tournament ("from"/ghost) into another ("to"/canonical).
// For same-event duplicates that the automatic heuristics cannot match because
// their names/cities/weeks differ too much — e.g. "Istanbul TTF" and
// "İstanbul (İstinye)", which are the same Challenger.
//
// Usage:
//   GET /api/merge-tournaments?from=<slug|name>&to=<slug|name>&apply=true
// Dry-run by default. Each of from/to must resolve to exactly one tournament.

type TournamentRow = { id: string; slug: string; name: string; city: string | null; country: string | null };

async function resolveTournament(query: string): Promise<TournamentRow[]> {
  const bySlug = await pool.query<TournamentRow>(
    `select id, slug, name, city, country from tournaments where slug = $1`,
    [query]
  );
  if (bySlug.rows.length) return bySlug.rows;

  const byText = await pool.query<TournamentRow>(
    `select id, slug, name, city, country from tournaments
     where name ilike $1 or city ilike $1 or slug ilike $1
     order by name
     limit 10`,
    [`%${query}%`]
  );
  return byText.rows;
}

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

  const [fromMatches, toMatches] = await Promise.all([resolveTournament(fromQ), resolveTournament(toQ)]);

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

  const ghostEditions = await pool.query<{ id: string; year: number }>(
    `select id, year from tournament_editions where tournament_id = $1 order by year`,
    [ghost.id]
  );

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      from: ghost,
      to: canonical,
      ghostEditionYears: ghostEditions.rows.map((r) => r.year),
      note: 'Re-run with &apply=true to move ghost editions into the canonical tournament and delete the ghost.',
    });
  }

  let movedEditions = 0;
  let mergedConflictYears = 0;

  try {
    await pool.query('BEGIN');

    const canonicalYears = await pool.query<{ year: number }>(
      `select year from tournament_editions where tournament_id = $1`,
      [canonical.id]
    );
    const yearSet = new Set(canonicalYears.rows.map((r) => r.year));

    for (const ed of ghostEditions.rows) {
      if (yearSet.has(ed.year)) {
        // Canonical already has this year — merge cutoffs into its edition, then drop the ghost edition.
        const target = await pool.query<{ id: string }>(
          `select id from tournament_editions where tournament_id = $1 and year = $2 limit 1`,
          [canonical.id, ed.year]
        );
        const targetId = target.rows[0]?.id;
        if (!targetId) continue;

        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
           )
           select $2,
             event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, now()
           from cutoff_snapshots
           where tournament_edition_id = $1
           on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
          [ed.id, targetId]
        );
        await pool.query('delete from cutoff_snapshots where tournament_edition_id = $1', [ed.id]);
        await pool.query('delete from tournament_editions where id = $1', [ed.id]);
        mergedConflictYears += 1;
      } else {
        await pool.query('update tournament_editions set tournament_id = $1, updated_at = now() where id = $2', [
          canonical.id,
          ed.id,
        ]);
        movedEditions += 1;
      }
    }

    const remaining = await pool.query<{ cnt: string }>(
      'select count(*) as cnt from tournament_editions where tournament_id = $1',
      [ghost.id]
    );
    const ghostDeleted = Number(remaining.rows[0].cnt) === 0;
    if (ghostDeleted) await pool.query('delete from tournaments where id = $1', [ghost.id]);

    await pool.query('COMMIT');

    return NextResponse.json({
      ok: true,
      dryRun: false,
      from: ghost.slug,
      to: canonical.slug,
      movedEditions,
      mergedConflictYears,
      ghostDeleted,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

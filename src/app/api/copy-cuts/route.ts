import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Copy cutoff snapshots for a single year from one tournament to another,
// WITHOUT moving any editions or deleting the source. Use when two tournament
// rows are the same event but you only want to share one year's cuts — e.g.
// copy 2026 cuts from "Istanbul TTF" into "İstanbul (İstinye)" while leaving
// both tournaments and all other years untouched.
//
// Usage:
//   GET /api/copy-cuts?from=<slug|name>&to=<slug|name>&year=2026&apply=true
// Dry-run by default. from/to must each resolve to exactly one tournament.

type TournamentRow = { id: string; slug: string; name: string; city: string | null; country: string | null };
type CutRow = {
  event_type: string;
  draw_type: string;
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_player_name: string | null;
  challenger_doubles_advanced_cut_rank: number | null;
  challenger_doubles_onsite_cut_rank: number | null;
  source_notes: string | null;
};

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

async function getEdition(tournamentId: string, year: number): Promise<{ id: string } | null> {
  const r = await pool.query<{ id: string }>(
    `select id from tournament_editions where tournament_id = $1 and year = $2 limit 1`,
    [tournamentId, year]
  );
  return r.rows[0] ?? null;
}

async function getCuts(editionId: string): Promise<CutRow[]> {
  const r = await pool.query<CutRow>(
    `select event_type, draw_type, last_direct_acceptance_rank, last_direct_acceptance_player_name,
            challenger_doubles_advanced_cut_rank, challenger_doubles_onsite_cut_rank, source_notes
     from cutoff_snapshots where tournament_edition_id = $1
     order by event_type, draw_type`,
    [editionId]
  );
  return r.rows;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const fromQ = sp.get('from');
  const toQ = sp.get('to');
  const yearParam = sp.get('year');
  const apply = sp.get('apply') === 'true';

  if (!fromQ || !toQ || !yearParam) {
    return NextResponse.json(
      { ok: false, error: 'Required: from, to (slug or name), year. Optional: apply=true (default dry-run).' },
      { status: 400 }
    );
  }

  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
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

  const source = fromMatches[0];
  const dest = toMatches[0];
  if (source.id === dest.id) {
    return NextResponse.json({ ok: false, error: 'from and to resolve to the same tournament' }, { status: 400 });
  }

  const sourceEdition = await getEdition(source.id, year);
  const destEdition = await getEdition(dest.id, year);

  if (!sourceEdition) {
    return NextResponse.json(
      { ok: false, error: `Source tournament "${source.slug}" has no ${year} edition.` },
      { status: 404 }
    );
  }
  if (!destEdition) {
    return NextResponse.json(
      {
        ok: false,
        error: `Destination tournament "${dest.slug}" has no ${year} edition. Run /api/sync-canonical first to create it.`,
      },
      { status: 404 }
    );
  }

  const sourceCuts = await getCuts(sourceEdition.id);

  if (!apply) {
    const destCutsBefore = await getCuts(destEdition.id);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      year,
      from: { slug: source.slug, name: source.name, editionId: sourceEdition.id },
      to: { slug: dest.slug, name: dest.name, editionId: destEdition.id },
      sourceCuts,
      destCutsBefore,
      willCopy: sourceCuts.length,
      note: `Re-run with &apply=true to copy these ${sourceCuts.length} cut row(s) into ${dest.slug} ${year}. The source is left untouched.`,
    });
  }

  if (sourceCuts.length === 0) {
    return NextResponse.json({ ok: true, dryRun: false, year, copied: 0, note: 'Source had no cuts to copy.' });
  }

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
     on conflict (tournament_edition_id, event_type, draw_type)
     do update set
       source_type = excluded.source_type,
       last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
       last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
       challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
       challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
       parsed_at = excluded.parsed_at,
       parser_version = excluded.parser_version,
       source_notes = excluded.source_notes,
       alternate_entries_count = excluded.alternate_entries_count,
       lucky_loser_count = excluded.lucky_loser_count,
       updated_at = now()`,
    [sourceEdition.id, destEdition.id]
  );

  const destCutsAfter = await getCuts(destEdition.id);

  return NextResponse.json({
    ok: true,
    dryRun: false,
    year,
    from: source.slug,
    to: dest.slug,
    copied: sourceCuts.length,
    destCutsAfter,
  });
}

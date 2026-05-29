import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nukes cutoff_snapshots rows that the PDF parser mis-extracted (tennis scores
// read as ranks, prize money read as ranks, tournament titles read as player
// names, etc). Heuristics match what isSpuriousNameRank in the parser rejects.
// Default is a dry run so the operator can see what would go before deleting.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const apply = params.get('apply') === 'true';

  // Build a single boolean SQL predicate per garbage signal.
  const garbageWhere = `
    (
      -- ATP rankings cap well below 5000; numbers in this band are almost
      -- always calendar years extracted from a tournament title.
      (last_direct_acceptance_rank between 1900 and 2100)
      or last_direct_acceptance_rank > 5000
      -- Rank 1 or 2 is never a valid LDA; values this low are seed/position markers.
      or last_direct_acceptance_rank < 3
      -- Names that are pure digits are scores, not players.
      or last_direct_acceptance_player_name ~ '^[[:space:]]*\\d+[[:space:]]*$'
      -- Currency-tagged prize-money lines.
      or last_direct_acceptance_player_name ~* '€|\\$|£'
      or last_direct_acceptance_player_name ~* 'PRIZE\\s*MONEY'
      or last_direct_acceptance_player_name ~* 'FIRST\\s*ROUND'
      or last_direct_acceptance_player_name ~* 'SEEDED\\s*(PLAYERS|TEAMS)'
      -- Tournament-title tells.
      or last_direct_acceptance_player_name ~* 'CHALLENGER\\s*SUPERVISOR'
      or last_direct_acceptance_player_name ~* '^CHALLENGER\\b'
      or last_direct_acceptance_player_name ~* '\\bOPEN\\b'
      or last_direct_acceptance_player_name ~* '\\bMASTERS\\b'
      or last_direct_acceptance_player_name ~* '\\bCITTA\\b'
      or last_direct_acceptance_player_name ~* '\\bINDOOR\\b'
      -- Draw-round headings near prize tables ("QUARTER-FINALIST 2").
      or last_direct_acceptance_player_name ~* '(QUARTER|SEMI)[\\s-]FINALIST'
      -- Label text captured as player name ("LAST DIRECT ACCEPTANCE IN DRAW 50").
      or last_direct_acceptance_player_name ~* '^LAST\\s+DIRECT\\s+ACCEPTANCE'
      -- Madrid combined-ranking notation ("D+D 88; S+S 414").
      or last_direct_acceptance_player_name ~ '[A-Z]\\+[A-Z]'
      -- Names that look like tennis set scores (e.g. "62 75", "64 26 10").
      or last_direct_acceptance_player_name ~ '^\\d{2}(\\s+\\d{1,3})+$'
    )
    -- Don't disturb challenger doubles cuts that were extracted via the
    -- separate Advanced/On-site parse path; those have rank info in the
    -- challenger_doubles_* columns regardless of what landed in
    -- last_direct_acceptance_*.
    and (
      challenger_doubles_advanced_cut_rank is null
      and challenger_doubles_onsite_cut_rank is null
    )
  `;

  const previewResult = await pool.query<{
    id: string;
    edition_id: string;
    event_type: string;
    draw_type: string;
    rank: number | null;
    name: string | null;
    slug: string;
    year: number;
  }>(
    `select
       cs.id,
       cs.tournament_edition_id as edition_id,
       cs.event_type,
       cs.draw_type,
       cs.last_direct_acceptance_rank as rank,
       cs.last_direct_acceptance_player_name as name,
       t.slug,
       te.year
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where ${garbageWhere}
     order by te.year, t.slug
     limit 500`
  );

  if (!apply) {
    return NextResponse.json({
      ok: true,
      apply: false,
      previewCount: previewResult.rowCount ?? 0,
      sample: previewResult.rows.slice(0, 50),
      message: 'Dry run. Append ?apply=true to delete these rows.',
    });
  }

  const deleteResult = await pool.query(`delete from cutoff_snapshots where ${garbageWhere}`);

  return NextResponse.json({
    ok: true,
    apply: true,
    deletedCount: deleteResult.rowCount ?? 0,
    sampleOfDeleted: previewResult.rows.slice(0, 50),
    message: 'Deleted. Run /api/run-all (with ?force=true to bypass tombstones) to re-attempt these draws with the fixed parser.',
  });
}

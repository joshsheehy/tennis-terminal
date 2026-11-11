import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { extractChallengerDoublesCuts, isSeededTeamRow } from '@/lib/cutoff-pdf-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-reads stored Challenger doubles cuts with the parser's current rules, from
// the raw box text each row already keeps in source_notes — no PDF is fetched.
//
// Two misreads it fixes, both rows holding a single number where the sheet
// gave something else:
//
//   - "Adv. (389)/On-site (509)": the bracketed form of the two Challenger
//     doubles cuts. The parser used to miss both numbers and store the line as
//     one team with a cut of 509, losing the advance cut. Both are set from
//     the raw text (Wuxi 2026, Maia 2023, and nine 2022-23 sheets).
//   - "1 Romios / Seggerman 139": the top row of the Seeded Teams table, read
//     by an older parser beside an empty Last Direct Acceptance box. The
//     sheet printed no cut, so the number is cleared (Canberra 2026, and
//     Cagliari, Olbia and Turin 2024).
//
// A re-import cannot do either: a parse that finds no cut leaves the stored one
// in place, so the Canberra figure would have survived every re-run.
//
//   GET /api/repair-doubles-cuts             — dry run, lists every change
//   GET /api/repair-doubles-cuts?apply=true

type Row = {
  id: string;
  slug: string;
  year: number;
  level: string;
  rank: number;
  name: string | null;
  source_notes: string | null;
};

// "… Raw Last Direct Acceptance: Adv. (389)/On-site (509). Historical edition …" or "… Raw: 1 Cash / Galloway 96."
// The raw text can hold its own full stops ("Adv."), so it ends at the first one followed by a new sentence.
function rawBoxText(notes: string | null): string | null {
  const match = notes?.match(/Raw(?: Last Direct Acceptance)?:\s*(.+?)\.(?=\s+[A-Z][a-z]|\s*$)/);
  return match ? match[1].trim() : null;
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const rows = await pool.query<Row>(
    `select cs.id, t.slug, te.year, te.level,
            cs.last_direct_acceptance_rank as rank,
            cs.last_direct_acceptance_player_name as name,
            cs.source_notes
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.event_type = 'doubles'
       and cs.draw_type = 'main'
       and cs.source_type = 'official_pdf'
       and te.level ilike 'Challenger%'
       and cs.last_direct_acceptance_rank is not null
       and cs.challenger_doubles_advanced_cut_rank is null
       and cs.challenger_doubles_onsite_cut_rank is null
     order by te.year, t.slug`
  );

  const split: Array<Record<string, unknown>> = [];
  const cleared: Array<Record<string, unknown>> = [];

  for (const row of rows.rows) {
    const raw = rawBoxText(row.source_notes);
    if (!raw) continue;

    const cuts = extractChallengerDoublesCuts(raw);
    if (cuts.advanced !== null && cuts.onsite !== null) {
      split.push({ slug: row.slug, year: row.year, raw, was: row.rank, advanced: cuts.advanced, onsite: cuts.onsite });
      if (apply) {
        await pool.query(
          `update cutoff_snapshots
           set challenger_doubles_advanced_cut_rank = $2,
               challenger_doubles_onsite_cut_rank = $3,
               updated_at = now()
           where id = $1`,
          [row.id, cuts.advanced, cuts.onsite]
        );
      }
      continue;
    }

    if (isSeededTeamRow(raw)) {
      cleared.push({ slug: row.slug, year: row.year, raw, was: row.rank });
      if (apply) {
        await pool.query(
          `update cutoff_snapshots
           set last_direct_acceptance_rank = null,
               last_direct_acceptance_player_name = null,
               source_notes = coalesce(source_notes, '') || $2,
               updated_at = now()
           where id = $1`,
          [
            row.id,
            ` Cleared ${new Date().toISOString().slice(0, 10)}: the sheet's Last Direct Acceptance box is blank;` +
              ` "${raw}" is the top row of the Seeded Teams table, not a cut.`,
          ]
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    apply,
    scanned: rows.rows.length,
    splitCount: split.length,
    clearedCount: cleared.length,
    split,
    cleared,
  });
}

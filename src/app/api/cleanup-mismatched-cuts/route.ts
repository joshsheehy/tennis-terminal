import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Two cleanup passes for cuts that ended up on the wrong edition:
//
// 1. URL-year mismatch.
//    cutoff_snapshots.source_notes always contains the ProTennisLive PDF URL
//    we pulled, e.g. "Official PDF: https://www.protennislive.com/posting/2024/336/mds.pdf".
//    The year in that URL must match the tournament_edition.year. If it doesn't
//    (because the old run-all fell back to neighbour-year URLs when the right
//    year's PDF 404'd), the cut belongs to a different season and should be
//    removed so the next run-all sweep refills it from the correct URL.
//
// 2. Consecutive-year duplicate cuts.
//    For the same tournament + event + draw, two adjacent years with identical
//    last_direct_acceptance_rank AND last_direct_acceptance_player_name are
//    almost certainly the result of bug #1 (same PDF read twice). We list those
//    pairs and, in apply mode, delete the row whose source URL year does NOT
//    match its edition year — preserving the one that is internally consistent.
//
// Dry run by default. Add ?apply=true to actually delete rows.
// ?onlyDuplicates=true skips the URL mismatch pass and only handles the
//   consecutive-year duplicate pass (useful if you want to see those alone).

type SnapshotRow = {
  id: string;
  tournament_id: string;
  slug: string;
  year: number;
  event_type: string;
  draw_type: string;
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_player_name: string | null;
  source_notes: string | null;
};

function urlYearFromNotes(notes: string | null): number | null {
  if (!notes) return null;
  const m = notes.match(/\/posting\/(\d{4})\//);
  return m ? Number(m[1]) : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const apply = params.get('apply') === 'true';
  const onlyDuplicates = params.get('onlyDuplicates') === 'true';

  let urlMismatchDeleted = 0;
  let urlMismatchPreview: Array<{
    id: string;
    slug: string;
    edition_year: number;
    url_year: number;
    event_type: string;
    draw_type: string;
    rank: number | null;
    name: string | null;
  }> = [];

  // ── Pass 1: URL year ≠ edition year ─────────────────────────────────
  if (!onlyDuplicates) {
    const candidates = await pool.query<SnapshotRow>(
      `select
         cs.id,
         te.tournament_id,
         t.slug,
         te.year,
         cs.event_type,
         cs.draw_type,
         cs.last_direct_acceptance_rank,
         cs.last_direct_acceptance_player_name,
         cs.source_notes
       from cutoff_snapshots cs
       join tournament_editions te on te.id = cs.tournament_edition_id
       join tournaments t on t.id = te.tournament_id
       where cs.source_notes ~ '/posting/\\d+/'`
    );

    const badIds: string[] = [];
    for (const row of candidates.rows) {
      const urlYear = urlYearFromNotes(row.source_notes);
      if (urlYear === null) continue;
      if (urlYear === row.year) continue;
      // For Dec-starting editions, the PTL URL year sometimes equals the
      // calendar year of the start date, which differs from the ATP season
      // year by 1. Tolerate exactly that case (year - 1) but no further.
      if (urlYear === row.year - 1) continue;
      badIds.push(row.id);
      if (urlMismatchPreview.length < 100) {
        urlMismatchPreview.push({
          id: row.id,
          slug: row.slug,
          edition_year: row.year,
          url_year: urlYear,
          event_type: row.event_type,
          draw_type: row.draw_type,
          rank: row.last_direct_acceptance_rank,
          name: row.last_direct_acceptance_player_name,
        });
      }
    }

    if (apply && badIds.length > 0) {
      const result = await pool.query(
        'delete from cutoff_snapshots where id = any($1::uuid[])',
        [badIds]
      );
      urlMismatchDeleted = result.rowCount ?? 0;
    } else {
      urlMismatchDeleted = 0;
    }

    // If apply=false, expose total count, not just preview length.
    if (!apply) urlMismatchPreview = urlMismatchPreview.slice(0, 100);

    if (!apply) {
      // For dry run we still want a true total of the candidate set.
      // urlMismatchPreview holds at most 100; count separately below.
    }

    // Save the total mismatch count for the response.
    (globalThis as Record<string, unknown>).__urlMismatchTotal = badIds.length;
  }
  const urlMismatchTotal = Number((globalThis as Record<string, unknown>).__urlMismatchTotal ?? 0);

  // ── Pass 2: consecutive-year duplicates ─────────────────────────────
  // Look for (tournament, event, draw) triples where two adjacent years share
  // the exact same rank + player name. That's the fingerprint of the wrong
  // year's PDF being read for one of them.
  const dupesResult = await pool.query<{
    tournament_id: string;
    slug: string;
    event_type: string;
    draw_type: string;
    year_a: number;
    year_b: number;
    rank: number;
    player_name: string;
    id_a: string;
    id_b: string;
    source_a: string | null;
    source_b: string | null;
  }>(
    `with snapshots as (
       select
         cs.id,
         te.tournament_id,
         t.slug,
         te.year,
         cs.event_type,
         cs.draw_type,
         cs.last_direct_acceptance_rank as rank,
         cs.last_direct_acceptance_player_name as player_name,
         cs.source_notes
       from cutoff_snapshots cs
       join tournament_editions te on te.id = cs.tournament_edition_id
       join tournaments t on t.id = te.tournament_id
       where cs.last_direct_acceptance_rank is not null
         and cs.last_direct_acceptance_player_name is not null
     )
     select
       a.tournament_id, a.slug, a.event_type, a.draw_type,
       a.year as year_a, b.year as year_b,
       a.rank, a.player_name,
       a.id as id_a, b.id as id_b,
       a.source_notes as source_a, b.source_notes as source_b
     from snapshots a
     join snapshots b
       on a.tournament_id = b.tournament_id
      and a.event_type = b.event_type
      and a.draw_type = b.draw_type
      and a.rank = b.rank
      and a.player_name = b.player_name
      and b.year = a.year + 1
     order by a.slug, a.event_type, a.draw_type, a.year`
  );

  const duplicatePreview = dupesResult.rows.slice(0, 100);
  let duplicateDeleted = 0;
  if (apply && dupesResult.rows.length > 0) {
    const toDelete: string[] = [];
    for (const row of dupesResult.rows) {
      const urlYearA = urlYearFromNotes(row.source_a);
      const urlYearB = urlYearFromNotes(row.source_b);
      // Prefer to keep the row whose source URL year matches its edition
      // year. If neither matches, delete both because we can't tell which
      // is real. If both match (the rare legitimately-identical-cut case),
      // leave them alone.
      const aMatches = urlYearA === row.year_a;
      const bMatches = urlYearB === row.year_b;
      if (aMatches && bMatches) continue;
      if (aMatches && !bMatches) toDelete.push(row.id_b);
      else if (!aMatches && bMatches) toDelete.push(row.id_a);
      else {
        toDelete.push(row.id_a, row.id_b);
      }
    }
    if (toDelete.length > 0) {
      const result = await pool.query(
        'delete from cutoff_snapshots where id = any($1::uuid[])',
        [toDelete]
      );
      duplicateDeleted = result.rowCount ?? 0;
    }
  }

  return NextResponse.json({
    ok: true,
    apply,
    onlyDuplicates,
    urlMismatch: {
      totalDetected: urlMismatchTotal,
      deleted: urlMismatchDeleted,
      sample: urlMismatchPreview,
    },
    consecutiveYearDuplicates: {
      totalPairsDetected: dupesResult.rows.length,
      deleted: duplicateDeleted,
      sample: duplicatePreview,
    },
    message: apply
      ? 'Deleted. Run /api/run-all (?force=true if needed) to refill from the correct PDFs.'
      : 'Dry run. Append ?apply=true to delete.',
  });
}

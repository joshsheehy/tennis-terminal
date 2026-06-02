import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ANOMALY_TAG, checkRankAnomaly } from '@/lib/cutoff-anomaly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retroactive sweep: find every cutoff_snapshots row whose stored cut is
// below the structural minimum for its tournament's level/event/draw, null
// the rank, and tag source_notes with ANOMALY_REJECTED.
//
// The parser hardening in cutoff-anomaly.ts only blocks *new* anomalous
// imports — existing garbage that was written before the fix has to be
// cleaned out explicitly. After this runs, anomalous rows render as
// "Not on record" on the schedule (the page already handles null ranks)
// and the operator can fix them by hand via /api/set-cut.
//
// Dry-run by default; pass ?apply=true to write.

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const rows = await pool.query<{
    id: string;
    event_type: 'singles' | 'doubles';
    draw_type: 'main' | 'qualifying';
    last_direct_acceptance_rank: number;
    last_direct_acceptance_player_name: string | null;
    source_notes: string | null;
    slug: string;
    name: string;
    year: number;
    level: string;
  }>(
    `select cs.id,
            cs.event_type, cs.draw_type,
            cs.last_direct_acceptance_rank,
            cs.last_direct_acceptance_player_name,
            cs.source_notes,
            t.slug, t.name, te.year, te.level
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.last_direct_acceptance_rank is not null`
  );

  type Hit = {
    id: string;
    slug: string;
    name: string;
    year: number;
    level: string;
    event: 'singles' | 'doubles';
    draw: 'main' | 'qualifying';
    rejectedRank: number;
    minimumExpected: number;
    reason: string;
    previousNotes: string | null;
  };

  const hits: Hit[] = [];
  for (const row of rows.rows) {
    const anomaly = checkRankAnomaly(
      row.last_direct_acceptance_rank,
      row.level,
      row.event_type,
      row.draw_type
    );
    if (!anomaly) continue;
    hits.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      year: row.year,
      level: row.level,
      event: row.event_type,
      draw: row.draw_type,
      rejectedRank: anomaly.rejectedRank,
      minimumExpected: anomaly.minimumExpected,
      reason: anomaly.reason,
      previousNotes: row.source_notes,
    });
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      foundCount: hits.length,
      hits: hits.map(({ previousNotes: _, ...rest }) => rest),
      note: 'Re-run with ?apply=true to null these ranks and stamp source_notes with ANOMALY_REJECTED.',
    });
  }

  let cleaned = 0;
  for (const h of hits) {
    const previous = (h.previousNotes ?? '').trim();
    // Don't double-tag if a previous cleanup already ran on this row.
    const alreadyTagged = previous.includes(ANOMALY_TAG);
    const newNotes = alreadyTagged
      ? previous
      : `${previous}${previous ? ' | ' : ''}${ANOMALY_TAG}: ${h.reason} (retro-cleanup)`;
    await pool.query(
      `update cutoff_snapshots
       set last_direct_acceptance_rank = null,
           last_direct_acceptance_player_name = null,
           source_notes = $2,
           updated_at = now()
       where id = $1`,
      [h.id, newNotes]
    );
    cleaned += 1;
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    cleanedCount: cleaned,
    hits: hits.map(({ previousNotes: _, ...rest }) => rest),
  });
}

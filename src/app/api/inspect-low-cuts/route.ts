import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only sweep that surfaces every cutoff_snapshots row whose stored cut
// rank is below a configurable threshold. Covers all four cut columns:
//
//   - last_direct_acceptance_rank — ATP Tour and most Challenger draws
//   - challenger_doubles_advanced_cut_rank — Challenger doubles advanced cut
//   - challenger_doubles_onsite_cut_rank — Challenger doubles on-site cut
//
// Without including the Challenger doubles columns, the inspector silently
// misses every Challenger doubles row because its rank lives in a different
// field — which is what was happening: Challengers appeared "absent" from
// the results even though several almost certainly have bad cuts.
//
// Defaults to threshold 30 — no real ATP or Challenger event has a cut that
// low. Override with ?minRank=N when you want to scan up to a softer band
// (e.g. ?minRank=100 to surface every Challenger main-draw cut below 100,
// most of which warrant a second look).
//
// Stricter than /api/cleanup-anomalous-cuts: that one uses level-aware
// structural minimums (e.g. ATP 250 singles main floor of 10) and is
// destructive. This endpoint is read-only and uses a single threshold.
//
// Output is sorted by current rank ascending (most suspicious first).

type DbHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  year: number;
  level: string;
  event_type: 'singles' | 'doubles';
  draw_type: 'main' | 'qualifying';
  rank: number;
  rank_column: 'last_direct_acceptance' | 'challenger_doubles_advanced' | 'challenger_doubles_onsite';
  last_direct_acceptance_player_name: string | null;
  source_type: string;
  source_notes: string | null;
};

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('minRank');
  const threshold = raw ? Number(raw) : 30;
  if (!Number.isFinite(threshold) || threshold < 1) {
    return NextResponse.json(
      { ok: false, error: 'minRank must be a positive integer' },
      { status: 400 }
    );
  }

  // Union over the three rank-bearing columns so Challenger doubles rows
  // surface alongside ATP/singles ones. Each row in the result carries the
  // column it came from so the operator knows which field needs fixing.
  const rows = await pool.query<DbHit>(
    `with base as (
       select cs.id, t.slug, t.name, t.city, te.year, te.level,
              cs.event_type, cs.draw_type,
              cs.last_direct_acceptance_rank,
              cs.challenger_doubles_advanced_cut_rank,
              cs.challenger_doubles_onsite_cut_rank,
              cs.last_direct_acceptance_player_name,
              cs.source_type, cs.source_notes
       from cutoff_snapshots cs
       join tournament_editions te on te.id = cs.tournament_edition_id
       join tournaments t on t.id = te.tournament_id
       where te.status = 'held'
     )
     select id, slug, name, city, year, level, event_type, draw_type,
            last_direct_acceptance_rank as rank,
            'last_direct_acceptance' as rank_column,
            last_direct_acceptance_player_name, source_type, source_notes
       from base
       where last_direct_acceptance_rank is not null
         and last_direct_acceptance_rank < $1
     union all
     select id, slug, name, city, year, level, event_type, draw_type,
            challenger_doubles_advanced_cut_rank as rank,
            'challenger_doubles_advanced' as rank_column,
            last_direct_acceptance_player_name, source_type, source_notes
       from base
       where challenger_doubles_advanced_cut_rank is not null
         and challenger_doubles_advanced_cut_rank < $1
     union all
     select id, slug, name, city, year, level, event_type, draw_type,
            challenger_doubles_onsite_cut_rank as rank,
            'challenger_doubles_onsite' as rank_column,
            last_direct_acceptance_player_name, source_type, source_notes
       from base
       where challenger_doubles_onsite_cut_rank is not null
         and challenger_doubles_onsite_cut_rank < $1
     order by rank asc, year desc, slug asc, event_type, draw_type`,
    [threshold]
  );

  return NextResponse.json({
    ok: true,
    threshold,
    foundCount: rows.rows.length,
    hits: rows.rows.map((r) => ({
      slug: r.slug,
      tournament: r.name,
      city: r.city,
      year: r.year,
      level: r.level,
      event: r.event_type,
      draw: r.draw_type,
      rankColumn: r.rank_column,
      currentRank: r.rank,
      currentName: r.last_direct_acceptance_player_name,
      sourceType: r.source_type,
      sourceNotes: r.source_notes,
    })),
  });
}

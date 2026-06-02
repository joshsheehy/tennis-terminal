import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only sweep that surfaces every cutoff_snapshots row whose
// last_direct_acceptance_rank is below a configurable threshold. Defaults to
// 30 — no real ATP or Challenger event has a direct acceptance cut that low,
// so anything below it almost certainly came from a parser misread or a
// stale value that pre-dates the anomaly hardening.
//
// Stricter than /api/cleanup-anomalous-cuts: that one uses level-aware
// structural minimums (e.g. ATP 250 singles main floor of 10) and only flags
// values that are *impossible* for the draw size. This endpoint catches the
// "plausible but obviously wrong" band — useful for an operator review pass.
//
// Use:
//   GET /api/inspect-low-cuts            → threshold 30
//   GET /api/inspect-low-cuts?minRank=20 → threshold 20
//
// Output is sorted by current rank ascending (most suspicious first), then
// year desc, then slug.

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('minRank');
  const threshold = raw ? Number(raw) : 30;
  if (!Number.isFinite(threshold) || threshold < 1) {
    return NextResponse.json(
      { ok: false, error: 'minRank must be a positive integer' },
      { status: 400 }
    );
  }

  const rows = await pool.query<{
    id: string;
    slug: string;
    name: string;
    city: string;
    year: number;
    level: string;
    event_type: 'singles' | 'doubles';
    draw_type: 'main' | 'qualifying';
    last_direct_acceptance_rank: number;
    last_direct_acceptance_player_name: string | null;
    source_type: string;
    source_notes: string | null;
  }>(
    `select cs.id, t.slug, t.name, t.city, te.year, te.level,
            cs.event_type, cs.draw_type,
            cs.last_direct_acceptance_rank,
            cs.last_direct_acceptance_player_name,
            cs.source_type,
            cs.source_notes
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.last_direct_acceptance_rank is not null
       and cs.last_direct_acceptance_rank < $1
       and te.status = 'held'
     order by cs.last_direct_acceptance_rank asc,
              te.year desc,
              t.slug asc,
              cs.event_type,
              cs.draw_type`,
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
      currentRank: r.last_direct_acceptance_rank,
      currentName: r.last_direct_acceptance_player_name,
      sourceType: r.source_type,
      sourceNotes: r.source_notes,
    })),
  });
}

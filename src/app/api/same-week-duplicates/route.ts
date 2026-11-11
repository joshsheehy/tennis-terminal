import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { findSameWeekDuplicates, type WeekEdition } from '@/lib/same-week-duplicates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only: every pair of held ATP / Challenger editions in the same week, at
// the same level, naming the same place — which should never exist. See
// src/lib/same-week-duplicates.ts for how places are compared.
//
// Fixing one is a merge into the slug that carries the history
// (/api/merge-tournaments), plus an entry in tournament-aliases.ts when a
// calendar source will keep recreating the other name.
//
//   GET /api/same-week-duplicates            — every season from 2022
//   GET /api/same-week-duplicates?from=2026
//   GET /api/same-week-duplicates?byCategory=1   — Challenger vs Challenger, any tier

export async function GET(request: NextRequest) {
  const from = Number(request.nextUrl.searchParams.get('from') ?? 2022);
  const byCategory = request.nextUrl.searchParams.get('byCategory') === '1';
  if (!Number.isInteger(from) || from < 2000 || from > 2100) {
    return NextResponse.json({ ok: false, error: 'from must be a year' }, { status: 400 });
  }

  const rows = await pool.query<WeekEdition>(
    `select te.id as edition_id, t.slug, t.name, t.city, t.country, te.year,
            date_trunc('week', te.start_date)::date::text as week_start,
            te.start_date::text as start_date, te.level, te.source,
            (select count(*)::int from cutoff_snapshots cs where cs.tournament_edition_id = te.id) as cuts
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held'
       and te.start_date is not null
       and te.level not ilike 'ITF%'
       and te.year >= $1`,
    [from]
  );

  const groups = findSameWeekDuplicates(rows.rows, { byCategory });
  return NextResponse.json({ ok: true, from, byCategory, scanned: rows.rows.length, duplicateCount: groups.length, groups });
}

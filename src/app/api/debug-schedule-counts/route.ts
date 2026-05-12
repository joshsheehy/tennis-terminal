import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : 2025;

  if (![2024, 2025, 2026].includes(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024, 2025, or 2026' }, { status: 400 });
  }

  const heldByYear = await pool.query<{ year: number; held_count: string }>(
    `select year, count(*)::text as held_count
     from tournament_editions
     where status = 'held'
     group by year
     order by year`
  );

  const visibleWeekCounts = await pool.query<{ week: number; tournament_count: string }>(
    `with visible as (
       select
         greatest(1, (te.start_date::date - date_trunc('week', make_date(te.year, 1, 1))::date) / 7 + 1) as week
       from tournament_editions te
       where te.status = 'held'
         and te.year = $1
         and te.start_date is not null
         and not (
           extract(month from te.start_date) = 12
           and extract(year from te.start_date) = te.year
         )
     )
     select week, count(*)::text as tournament_count
     from visible
     group by week
     order by week`,
    [year]
  );

  const decemberBad = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from tournament_editions te
     where te.status = 'held'
       and te.year = $1
       and te.start_date is not null
       and extract(month from te.start_date) = 12
       and extract(year from te.start_date) = te.year`,
    [year]
  );


  const levelCountsByYear = await pool.query<{ year: number; level: string; count: string }>(
    `select te.year, te.level, count(*)::text as count
     from tournament_editions te
     where te.status = 'held'
       and te.level in ('ATP 250', 'ATP 500', 'ATP 1000', 'Challenger')
     group by te.year, te.level
     order by te.year, te.level`
  );

  const cutoffByYear = await pool.query<{ year: number; cutoff_count: string }>(
    `select te.year, count(cs.id)::text as cutoff_count
     from tournament_editions te
     left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
     where te.status = 'held'
     group by te.year
     order by te.year`
  );

  const unitedCupVisibleCount = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held'
       and te.year = $1
       and (
         lower(trim(t.name)) = 'united cup'
         or t.slug like 'united-cup%'
       )`,
    [year]
  );

  const invalidDoublesQualifyingCutoffCount = await pool.query<{ count: string }>(
    `select count(cs.id)::text as count
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     where te.year = $1
       and cs.event_type = 'doubles'
       and cs.draw_type = 'qualifying'
       and te.level <> 'ATP 500'`,
    [year]
  );

  return NextResponse.json({
    ok: true,
    year,
    heldByYear: heldByYear.rows,
    distinctVisibleWeeks: visibleWeekCounts.rows.length,
    decemberBadExcludedCount: Number(decemberBad.rows[0]?.count ?? 0),
    cutoffSnapshotsByYear: cutoffByYear.rows,
    sampleVisibleWeeks: visibleWeekCounts.rows.slice(0, 12),
    levelCountsByYear: levelCountsByYear.rows,
    unitedCupVisibleCount: Number(unitedCupVisibleCount.rows[0]?.count ?? 0),
    invalidDoublesQualifyingCutoffCount: Number(invalidDoublesQualifyingCutoffCount.rows[0]?.count ?? 0),
  });
}

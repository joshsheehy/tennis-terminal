import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await pool.query<{
    slug: string;
    name: string;
    level: string;
    year: number;
    week: number | null;
    has_singles_main: boolean;
    has_singles_qualifying: boolean;
    has_doubles_main: boolean;
    singles_main_cut: number | null;
  }>(`
    select
      t.slug,
      t.name,
      te.level,
      te.year,
      te.week,
      bool_or(cs.event_type = 'singles' and cs.draw_type = 'main')       as has_singles_main,
      bool_or(cs.event_type = 'singles' and cs.draw_type = 'qualifying') as has_singles_qualifying,
      bool_or(cs.event_type = 'doubles' and cs.draw_type = 'main')       as has_doubles_main,
      max(case when cs.event_type = 'singles' and cs.draw_type = 'main'
               then cs.last_direct_acceptance_rank end)                  as singles_main_cut
    from tournaments t
    join tournament_editions te on te.tournament_id = t.id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.status = 'held'
    group by t.slug, t.name, te.level, te.year, te.week
    order by te.year desc, te.week asc nulls last, t.name asc
  `);

  const rows = result.rows;
  const hasCuts = rows.filter((r) => r.has_singles_main);
  const missingCuts = rows.filter((r) => !r.has_singles_main);

  return NextResponse.json({
    summary: {
      total: rows.length,
      withCuts: hasCuts.length,
      missingCuts: missingCuts.length,
    },
    missingCuts: missingCuts.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      year: r.year,
      week: r.week,
    })),
    hasCuts: hasCuts.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      year: r.year,
      week: r.week,
      singles_main_cut: r.singles_main_cut,
    })),
  });
}

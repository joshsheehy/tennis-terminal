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
    has_singles_main_row: boolean;
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
      bool_or(cs.event_type = 'singles' and cs.draw_type = 'main')       as has_singles_main_row,
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
  const withCuts = rows.filter((r) => r.singles_main_cut !== null);
  const nullCuts = rows.filter((r) => r.has_singles_main_row && r.singles_main_cut === null);
  const missingCuts = rows.filter((r) => !r.has_singles_main_row);

  return NextResponse.json({
    summary: {
      total: rows.length,
      withCuts: withCuts.length,
      nullCuts: nullCuts.length,
      missingCuts: missingCuts.length,
    },
    withCuts: withCuts.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      year: r.year,
      week: r.week,
      singles_main_cut: r.singles_main_cut,
    })),
    nullCuts: nullCuts.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      year: r.year,
      week: r.week,
      singles_main_cut: r.singles_main_cut,
    })),
    missingCuts: missingCuts.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      year: r.year,
      week: r.week,
    })),
  });
}

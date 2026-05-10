import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_HAS_DOUBLES_QUAL = new Set(
  ALL_EDITIONS.filter((e) => e.edition.has_doubles_qualifying).map((e) => e.tournament.slug)
);
const ALL_KNOWN_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

// Lists every tournament edition with at least one missing cut snapshot.
// Used for visibility into how complete the cut data is.
//
// For Challengers we treat doubles-qualifying as expected-missing (no doubles qual).
// For ATP we expect all four: singles main, singles qual, doubles main, doubles qual.

type Row = {
  edition_id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  year: number;
  start_date: string;
  level: string;
  has_singles_main: boolean;
  has_singles_qual: boolean;
  has_doubles_main: boolean;
  has_doubles_qual: boolean;
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : null;

  const queryParams: unknown[] = [];
  let yearFilter = '';
  if (year && [2024, 2025, 2026].includes(year)) {
    queryParams.push(year);
    yearFilter = `and te.year = $1`;
  }

  const result = await pool.query<Row>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      t.city,
      t.country,
      te.year,
      te.start_date::text as start_date,
      te.level,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qual,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qual
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.start_date is not null
      and te.year >= 2024
      ${yearFilter}
    order by te.year, te.start_date, t.name
    `,
    queryParams
  );

  const editions = result.rows.map((r) => {
    const isChallenger = r.level.toLowerCase().includes('challenger');
    const expectedDoublesQual = !isChallenger && (
      SLUG_HAS_DOUBLES_QUAL.has(r.slug) ||
      (!ALL_KNOWN_SLUGS.has(r.slug) && (r.level.includes('500') || r.level.includes('1000')))
    );
    const missing: string[] = [];
    if (!r.has_singles_main) missing.push('singles_main');
    if (!r.has_singles_qual) missing.push('singles_qual');
    if (!r.has_doubles_main) missing.push('doubles_main');
    if (expectedDoublesQual && !r.has_doubles_qual) missing.push('doubles_qual');
    return { ...r, missing, isChallenger };
  });

  const incomplete = editions.filter((e) => e.missing.length > 0);

  // Per-year summary
  const byYear: Record<number, { total: number; complete: number; incomplete: number }> = {};
  for (const e of editions) {
    if (!byYear[e.year]) byYear[e.year] = { total: 0, complete: 0, incomplete: 0 };
    byYear[e.year].total += 1;
    if (e.missing.length === 0) byYear[e.year].complete += 1;
    else byYear[e.year].incomplete += 1;
  }

  return NextResponse.json({
    ok: true,
    summary: byYear,
    totalEditions: editions.length,
    completeEditions: editions.length - incomplete.length,
    incompleteEditions: incomplete.length,
    missing: incomplete.map((e) => ({
      slug: e.slug,
      name: e.name,
      city: e.city,
      country: e.country,
      year: e.year,
      start_date: e.start_date,
      level: e.level,
      missing: e.missing,
    })),
  });
}

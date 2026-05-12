import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  level: string;
  week: number | null;
  start_date: string;
  source_url: string | null;
  has_singles_main: boolean;
  has_singles_qualifying: boolean;
  has_doubles_main: boolean;
  has_doubles_qualifying: boolean;
  null_singles_main: boolean;
  null_singles_qualifying: boolean;
  null_doubles_main: boolean;
  null_doubles_qualifying: boolean;
};

const PTL_CODE_RE = /\/archive\/[^/]+\/(\d+)\/\d{4}\/results/i;

type ExpectedDraw = { eventType: 'singles' | 'doubles'; drawType: 'main' | 'qualifying'; label: string };

function expectedDraws(level: string): ExpectedDraw[] {
  const draws: ExpectedDraw[] = [
    { eventType: 'singles' as const, drawType: 'main' as const, label: 'singles main' },
    { eventType: 'singles' as const, drawType: 'qualifying' as const, label: 'singles qualifying' },
    { eventType: 'doubles' as const, drawType: 'main' as const, label: 'doubles main' },
  ];

  if (level === 'ATP 500') {
    draws.push({ eventType: 'doubles' as const, drawType: 'qualifying' as const, label: 'doubles qualifying' });
  }

  return draws;
}

export async function GET(request: NextRequest) {
  const yearParam = Number(request.nextUrl.searchParams.get('year') ?? '2024');
  const year = Number.isFinite(yearParam) ? yearParam : 2024;

  const result = await pool.query<EditionRow>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      te.level,
      te.week,
      te.start_date::text as start_date,
      te.source_url,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qualifying,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qualifying,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is null) as null_singles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is null) as null_singles_qualifying,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is null) as null_doubles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is null) as null_doubles_qualifying
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.start_date is not null
      and te.year = $1
    order by te.start_date, t.name
    `,
    [year]
  );

  const missingByTournament: Array<{
    slug: string;
    name: string;
    level: string;
    week: number | null;
    start_date: string;
    missing: string[];
  }> = [];

  const missingByLevel: Record<string, number> = {};
  const missingByDrawType: Record<string, number> = {
    'singles main': 0,
    'singles qualifying': 0,
    'doubles main': 0,
    'doubles qualifying': 0,
  };

  const nullCutRows: Array<{ slug: string; name: string; level: string; week: number | null; start_date: string; rows: string[] }> = [];
  const skippedNoPdf: Array<{ slug: string; name: string; level: string; week: number | null; start_date: string; source_url: string | null; ptlCode: string | null }> = [];

  let expectedCutoffRows = 0;
  let existingCutoffRows = 0;

  for (const row of result.rows) {
    const expected = expectedDraws(row.level);
    expectedCutoffRows += expected.length;

    const missing: string[] = [];
    const nullRows: string[] = [];

    for (const draw of expected) {
      let existsForDraw = false;
      let hasNullRow = false;

      if (draw.label === 'singles main') {
        existsForDraw = row.has_singles_main;
        hasNullRow = row.null_singles_main;
      } else if (draw.label === 'singles qualifying') {
        existsForDraw = row.has_singles_qualifying;
        hasNullRow = row.null_singles_qualifying;
      } else if (draw.label === 'doubles main') {
        existsForDraw = row.has_doubles_main;
        hasNullRow = row.null_doubles_main;
      } else if (draw.label === 'doubles qualifying') {
        existsForDraw = row.has_doubles_qualifying;
        hasNullRow = row.null_doubles_qualifying;
      }

      if (existsForDraw) existingCutoffRows += 1;
      else {
        missing.push(draw.label);
        missingByDrawType[draw.label] += 1;
      }

      if (hasNullRow) {
        nullRows.push(draw.label);
      }
    }

    if (missing.length > 0) {
      missingByTournament.push({
        slug: row.slug,
        name: row.name,
        level: row.level,
        week: row.week,
        start_date: row.start_date,
        missing,
      });
      missingByLevel[row.level] = (missingByLevel[row.level] ?? 0) + missing.length;

      const ptlCode = (row.source_url ?? '').match(PTL_CODE_RE)?.[1] ?? null;
      if (!ptlCode) {
        skippedNoPdf.push({
          slug: row.slug,
          name: row.name,
          level: row.level,
          week: row.week,
          start_date: row.start_date,
          source_url: row.source_url,
          ptlCode,
        });
      }
    }

    if (nullRows.length > 0) {
      nullCutRows.push({
        slug: row.slug,
        name: row.name,
        level: row.level,
        week: row.week,
        start_date: row.start_date,
        rows: nullRows,
      });
    }
  }

  const missingCutoffRows = expectedCutoffRows - existingCutoffRows;
  const coveragePercent = expectedCutoffRows === 0 ? 100 : Number(((existingCutoffRows / expectedCutoffRows) * 100).toFixed(2));

  return NextResponse.json({
    ok: true,
    year,
    totalEditions: result.rows.length,
    expectedCutoffRows,
    existingCutoffRows,
    missingCutoffRows,
    coveragePercent,
    missingByTournament,
    missingByLevel,
    missingByDrawType,
    nullCutRows,
    skippedNoPdf,
  });
}

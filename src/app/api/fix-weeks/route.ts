import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Recomputes and updates the `week` column for all editions of a given year
// using the correct ATP week formula: days since the first Monday of the ATP year
// (= Monday of the week containing Jan 7), divided by 7, plus 1.
// greatest(1,...) clamps pre-Jan-1 starters (e.g. Dec 30) to week 1.
//
// Examples for 2026 (first Monday = Jan 5, 2026):
//   Dec 30, 2025 → week 1
//   Jan 5, 2026  → week 1
//   Jan 12, 2026 → week 2
//   Jan 13, 2026 → week 2

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : 2026;

  if (![2024, 2025, 2026].includes(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024, 2025, or 2026' }, { status: 400 });
  }

  const result = await pool.query<{ id: string; start_date: string; new_week: number }>(
    `
    update tournament_editions te
    set week = greatest(1, (te.start_date::date - date_trunc('week', make_date(te.year, 1, 7))::date) / 7 + 1)
    where te.year = $1
      and te.start_date is not null
      -- Skip the bad "same-year December" records (e.g. year=2025, start=2025-12-30)
      and not (extract(month from te.start_date) = 12 and extract(year from te.start_date) = te.year)
    returning
      te.id,
      te.start_date::text,
      te.week as new_week
    `,
    [year]
  );

  return NextResponse.json({
    ok: true,
    year,
    updatedCount: result.rowCount,
    editions: result.rows.sort((a, b) => a.start_date.localeCompare(b.start_date)),
  });
}

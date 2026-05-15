import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Recomputes the `week` column using the ATP season Week-1 Monday rule from
// src/lib/atp-week.ts:
//   - Jan 1 on Mon/Tue/Wed → season starts on the Monday on or before Jan 1
//   - Jan 1 on Thu/Fri/Sat/Sun → season starts on the Monday after Jan 1
// greatest(1,...) clamps pre-season-start dates (e.g. Dec 29, 2025 for 2026) to week 1.
//
// Examples:
//   2024 Jan 1 (Mon)  → week 1; 2024 Jan 8 → week 2
//   2024 Dec 30 (Mon) → week 1 (counts as 2025); 2025 Jan 6 → week 2
//   2025 Dec 29 (Mon) → week 1 (counts as 2026); 2026 Jan 5 → week 1; 2026 Jan 12 → week 2

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
    set week = greatest(
      1,
      (te.start_date::date - (
        make_date(te.year, 1, 1)
        + case
            when extract(isodow from make_date(te.year, 1, 1))::int <= 3
              then 1 - extract(isodow from make_date(te.year, 1, 1))::int
            else 8 - extract(isodow from make_date(te.year, 1, 1))::int
          end
      )) / 7 + 1
    )
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

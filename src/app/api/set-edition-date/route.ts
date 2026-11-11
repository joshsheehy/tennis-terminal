import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getAtpWeekForSeason } from '@/lib/atp-week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Corrects one edition's start date, from the dates printed on its own draw
// sheet, and recomputes its ATP week. An end date moves with it.
//
// For dates that came out wrong rather than events that moved: Nonthaburi 2
// in 2024 and 2025 carried the 2026 catalogue's 12 January copied onto other
// years, and Nonthaburi 3 sat a week early in both, so the two events showed
// up as one event entered twice.
//
//   GET /api/set-edition-date?slug=nonthaburi-3&year=2024&start=2024-01-15            — dry run
//   GET /api/set-edition-date?slug=nonthaburi-3&year=2024&start=2024-01-15&apply=true

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get('slug');
  const year = Number(params.get('year'));
  const start = params.get('start') ?? '';
  const apply = params.get('apply') === 'true';

  if (!slug || !Number.isInteger(year) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ ok: false, error: 'Required: slug, year, start=YYYY-MM-DD; optional apply=true' }, { status: 400 });
  }
  const week = getAtpWeekForSeason(start, year);
  if (week == null) {
    return NextResponse.json({ ok: false, error: `${start} is not in the ${year} season` }, { status: 400 });
  }

  const before = await pool.query<{ id: string; start_date: string | null; end_date: string | null; week: number | null }>(
    `select te.id, te.start_date::text as start_date, te.end_date::text as end_date, te.week
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.year = $2`,
    [slug, year]
  );
  const row = before.rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: `No ${year} edition for ${slug}` }, { status: 404 });
  }

  if (apply) {
    await pool.query(
      `update tournament_editions
       set start_date = $2::date,
           end_date = case when end_date is null or start_date is null then end_date
                           else $2::date + (end_date - start_date) end,
           week = $3,
           updated_at = now()
       where id = $1`,
      [row.id, start, week]
    );
  }

  return NextResponse.json({
    ok: true,
    apply,
    slug,
    year,
    before: { start: row.start_date, end: row.end_date, week: row.week },
    after: { start, week },
  });
}

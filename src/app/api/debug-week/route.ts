import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only inspector: every edition whose start_date falls in a window,
// regardless of status or display filters. For diagnosing missing weeks.
//
//   GET /api/debug-week?year=2026&from=2026-02-16&to=2026-03-15

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? new Date().getFullYear());
  const from = params.get('from') ?? `${year}-01-01`;
  const to = params.get('to') ?? `${year}-12-31`;

  if (!Number.isInteger(year) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { ok: false, error: 'Usage: ?year=YYYY&from=YYYY-MM-DD&to=YYYY-MM-DD' },
      { status: 400 }
    );
  }

  const editions = await pool.query(
    `select te.week, te.start_date::text as start_date, te.status, te.level,
            t.slug, t.name, te.source,
            (select count(*)::int from cutoff_snapshots cs
             where cs.tournament_edition_id = te.id) as cuts
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.year = $1
       and te.start_date between $2 and $3
     order by te.start_date, te.status, t.name`,
    [year, from, to]
  );

  return NextResponse.json({
    ok: true,
    year,
    from,
    to,
    count: editions.rows.length,
    editions: editions.rows,
  });
}

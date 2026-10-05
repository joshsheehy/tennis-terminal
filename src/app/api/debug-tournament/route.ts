import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only inspector: every tournament/edition row whose slug, name or city
// matches a search term, with source_url and updated_at so a vanished
// ProTennisLive code can be traced to a specific duplicate row or sync step.
//
//   GET /api/debug-tournament?q=fort+worth

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ ok: false, error: 'Usage: ?q=search+term' }, { status: 400 });
  }

  const rows = await pool.query(
    `select t.id as tournament_id, t.slug, t.name, t.city, t.country, t.updated_at as tournament_updated_at,
            te.year, te.week, te.status, te.source, te.source_url, te.updated_at as edition_updated_at
     from tournaments t
     join tournament_editions te on te.tournament_id = t.id
     where t.slug ilike '%' || $1 || '%'
        or t.name ilike '%' || $1 || '%'
        or t.city ilike '%' || $1 || '%'
     order by t.slug, te.year desc`,
    [q.replace(/\s+/g, '%')]
  );

  return NextResponse.json({ ok: true, query: q, rowCount: rows.rowCount, rows: rows.rows });
}

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StatusRow = {
  tournament: string;
  city: string;
  year: number;
  start_date: string | Date;
  event_type: string;
  draw_type: string;
  atp_code: string | null;
  source_type: string;
  source_url: string;
  last_checked_at: string | Date | null;
  last_changed_at: string | Date | null;
  next_check_at: string | Date | null;
  failure_count: number;
  last_error: string | null;
  fetched_at: string | Date | null;
  list_date: string | Date | null;
  ranking_date: string | Date | null;
  original_cutoff_rank: number | null;
  parse_status: string | null;
  entry_count: number | null;
};

export async function GET() {
  const rows = await pool.query<StatusRow>(`
    select
      t.name as tournament,
      t.city,
      te.year,
      te.start_date,
      als.event_type,
      als.draw_type,
      als.atp_code,
      als.source_type,
      als.source_url,
      als.last_checked_at,
      als.last_changed_at,
      als.next_check_at,
      als.failure_count,
      als.last_error,
      latest.fetched_at,
      latest.list_date,
      latest.ranking_date,
      latest.original_cutoff_rank,
      latest.parse_status,
      latest.entry_count
    from acceptance_list_sources als
    join tournament_editions te on te.id = als.tournament_edition_id
    join tournaments t on t.id = te.tournament_id
    left join lateral (
      select s.fetched_at, s.list_date, s.ranking_date,
             s.original_cutoff_rank, s.parse_status, s.entry_count
      from acceptance_list_snapshots s
      where s.source_id = als.id
      order by s.fetched_at desc
      limit 1
    ) latest on true
    where als.active = true
    order by te.start_date, t.name, als.event_type, als.draw_type
  `);

  return NextResponse.json({ ok: true, sources: rows.rows });
}

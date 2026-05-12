import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const historical = await pool.query(
    `
    update tournament_editions te
    set status = 'held',
        updated_at = now()
    where te.year in (2024, 2025)
      and te.status = 'not_held'
      and exists (
        select 1
        from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
      )
    `
  );

  const current = await pool.query(
    `
    update tournament_editions te
    set status = 'held',
        updated_at = now()
    where te.year = 2026
      and te.status = 'not_held'
      and exists (
        select 1
        from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
      )
    `
  );

  return NextResponse.json({
    ok: true,
    restoredHistoricalWithCutsCount: historical.rowCount ?? 0,
    restoredCurrentWithCutsCount: current.rowCount ?? 0,
  });
}

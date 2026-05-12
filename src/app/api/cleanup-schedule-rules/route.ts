import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeName(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export async function GET(request: NextRequest) {
  const dryRunParam = request.nextUrl.searchParams.get('dryRun');
  const dryRun = dryRunParam === null ? true : dryRunParam !== 'false';

  const unitedCupCandidates = await pool.query<{ id: string; slug: string; name: string; year: number }>(
    `select te.id, t.slug, t.name, te.year
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug like 'united-cup%' or t.name ilike '%united cup%'`
  );

  const unitedCupEditionIds = unitedCupCandidates.rows
    .filter((row) => row.slug.startsWith('united-cup') || normalizeName(row.name) === 'united cup')
    .map((row) => row.id);

  const invalidDoublesQualifying = await pool.query<{ id: string; slug: string; year: number; level: string }>(
    `select cs.id, t.slug, te.year, te.level
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.event_type = 'doubles'
       and cs.draw_type = 'qualifying'
       and te.level <> 'ATP 500'`
  );

  if (!dryRun) {
    if (unitedCupEditionIds.length > 0) {
      await pool.query(
        `update tournament_editions
         set status = 'not_held', updated_at = now()
         where id = any($1::uuid[])`,
        [unitedCupEditionIds]
      );
    }

    await pool.query(
      `delete from cutoff_snapshots cs
       using tournament_editions te
       where cs.tournament_edition_id = te.id
         and cs.event_type = 'doubles'
         and cs.draw_type = 'qualifying'
         and te.level <> 'ATP 500'`
    );
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    unitedCupEditionsAffected: unitedCupEditionIds.length,
    invalidDoublesQualifyingCutoffsAffected: invalidDoublesQualifying.rows.length,
    examples: {
      unitedCupEditions: unitedCupCandidates.rows.slice(0, 5),
      invalidDoublesQualifyingCutoffs: invalidDoublesQualifying.rows.slice(0, 5),
    },
  });
}

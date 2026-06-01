import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One-off cleanup for the three stale 2026 ATP rows that sync-canonical's
// sweep skipped because they had cuts attached:
//
//   1. Estoril: an old import created a duplicate 2026 Estoril row at the
//      wrong week and wrong level. Migrate any cuts on it to the canonical
//      millennium-estoril-open-estoril (wk 29, ATP 250) row using
//      ON CONFLICT DO NOTHING (canonical cuts win in a tie), then mark the
//      stale row not_held.
//
//   2. Cordoba Open: the ATP 250 dropped off the 2026 calendar — Córdoba
//      now runs as a Challenger only. Mark the stale ATP row not_held.
//      Cuts stay on the row (just hidden from the schedule).
//
//   3. Zhuhai Championships: gone from 2026 (Hangzhou took its slot). Same
//      treatment as Cordoba.
//
// Dry-run by default; pass ?apply=true to write.

const CANONICAL_ESTORIL_SLUG = 'millennium-estoril-open-estoril';

type StaleRow = {
  editionId: string;
  slug: string;
  name: string;
  level: string;
  week: number | null;
  cutsCount: number;
};

async function findStaleRows(predicate: string, params: unknown[]): Promise<StaleRow[]> {
  const res = await pool.query<{
    edition_id: string;
    slug: string;
    name: string;
    level: string;
    week: number | null;
    cuts_count: string;
  }>(
    `select te.id as edition_id, t.slug, t.name, te.level, te.week,
            (select count(*) from cutoff_snapshots cs where cs.tournament_edition_id = te.id) as cuts_count
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.year = 2026
       and te.status = 'held'
       and ${predicate}`,
    params
  );
  return res.rows.map((r) => ({
    editionId: r.edition_id,
    slug: r.slug,
    name: r.name,
    level: r.level,
    week: r.week,
    cutsCount: Number(r.cuts_count),
  }));
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const staleEstoril = await findStaleRows(
    `t.slug <> $1 and (t.name ilike '%estoril%' or t.city ilike '%estoril%')`,
    [CANONICAL_ESTORIL_SLUG]
  );

  const canonicalEstorilRes = await pool.query<{ id: string }>(
    `select te.id from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.year = 2026 and t.slug = $1`,
    [CANONICAL_ESTORIL_SLUG]
  );
  const canonicalEstorilEditionId = canonicalEstorilRes.rows[0]?.id ?? null;

  const staleCordoba = await findStaleRows(
    `te.level like 'ATP%' and (t.name ilike '%cordoba%' or t.name ilike '%córdoba%' or t.slug ilike '%cordoba%')`,
    []
  );

  const staleZhuhai = await findStaleRows(
    `t.name ilike '%zhuhai%' or t.slug ilike '%zhuhai%'`,
    []
  );

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      canonicalEstorilEditionId,
      staleEstoril,
      staleCordoba,
      staleZhuhai,
      note: 'Re-run with ?apply=true to migrate Estoril cuts and hide all three.',
    });
  }

  let estorilCutsMigrated = 0;
  let estorilCutsConflicted = 0;
  let estorilHidden = 0;
  let cordobaHidden = 0;
  let zhuhaiHidden = 0;

  try {
    await pool.query('BEGIN');

    if (canonicalEstorilEditionId) {
      for (const row of staleEstoril) {
        const ins = await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
           )
           select $2,
             event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, now()
           from cutoff_snapshots
           where tournament_edition_id = $1
           on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
          [row.editionId, canonicalEstorilEditionId]
        );
        const inserted = ins.rowCount ?? 0;
        estorilCutsMigrated += inserted;
        estorilCutsConflicted += row.cutsCount - inserted;
      }
    }

    for (const row of staleEstoril) {
      const upd = await pool.query(
        `update tournament_editions set status = 'not_held', updated_at = now() where id = $1`,
        [row.editionId]
      );
      estorilHidden += upd.rowCount ?? 0;
    }

    for (const row of staleCordoba) {
      const upd = await pool.query(
        `update tournament_editions set status = 'not_held', updated_at = now() where id = $1`,
        [row.editionId]
      );
      cordobaHidden += upd.rowCount ?? 0;
    }

    for (const row of staleZhuhai) {
      const upd = await pool.query(
        `update tournament_editions set status = 'not_held', updated_at = now() where id = $1`,
        [row.editionId]
      );
      zhuhaiHidden += upd.rowCount ?? 0;
    }

    await pool.query('COMMIT');

    return NextResponse.json({
      ok: true,
      dryRun: false,
      canonicalEstorilEditionId,
      staleEstoril,
      staleCordoba,
      staleZhuhai,
      estorilCutsMigrated,
      estorilCutsConflicted,
      estorilHidden,
      cordobaHidden,
      zhuhaiHidden,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

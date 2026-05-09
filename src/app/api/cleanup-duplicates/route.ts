import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Finds tournament editions that share the same (normalized name, calendar week, year) — true duplicates.
// With dryRun=true (default), just reports what would be removed.
// With dryRun=false, merges cutoff_snapshots to the primary edition and deletes duplicates.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dryRun') !== 'false';
  const yearParam = params.get('year');

  let yearFilter = '';
  const queryParams: unknown[] = [];
  if (yearParam) {
    queryParams.push(Number(yearParam));
    yearFilter = `and te.year = $1`;
  }

  // Find groups of editions sharing the same normalized name + calendar week + year.
  // Normalization strips trailing " Ch N" and trailing standalone numbers,
  // so "Zadar", "Zadar Ch", and "Zadar 1" all collapse to "zadar".
  const dupeQuery = await pool.query(
    `
    select
      regexp_replace(
        regexp_replace(lower(t.name), '\\s+ch(\\s+\\d+)?$', ''),
        '\\s+\\d+$', ''
      ) as norm_name,
      date_trunc('week', te.start_date) as cal_week,
      te.year,
      count(*) as cnt,
      json_agg(json_build_object(
        'edition_id', te.id,
        'tournament_id', t.id,
        'slug', t.slug,
        'name', t.name,
        'start_date', te.start_date,
        'source', te.source,
        'updated_at', te.updated_at,
        'cutoff_count', (select count(*) from cutoff_snapshots cs where cs.tournament_edition_id = te.id)
      ) order by te.updated_at desc nulls last) as editions
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.start_date is not null
      ${yearFilter}
    group by
      regexp_replace(
        regexp_replace(lower(t.name), '\\s+ch(\\s+\\d+)?$', ''),
        '\\s+\\d+$', ''
      ),
      date_trunc('week', te.start_date),
      te.year
    having count(*) > 1
    order by te.year, date_trunc('week', te.start_date),
      regexp_replace(
        regexp_replace(lower(t.name), '\\s+ch(\\s+\\d+)?$', ''),
        '\\s+\\d+$', ''
      )
    `,
    queryParams
  );

  const groups = dupeQuery.rows as Array<{
    norm_name: string;
    cal_week: string;
    year: number;
    cnt: string;
    editions: Array<{
      edition_id: string;
      tournament_id: string;
      slug: string;
      name: string;
      start_date: string | null;
      source: string;
      updated_at: string;
      cutoff_count: string;
    }>;
  }>;

  if (groups.length === 0) {
    return NextResponse.json({ ok: true, message: 'No duplicate tournaments found', groups: [] });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      duplicateGroupCount: groups.length,
      groups: groups.map((g) => ({
        name: g.editions[0].name,
        calWeek: g.cal_week,
        year: g.year,
        count: Number(g.cnt),
        editions: g.editions,
        willKeep: g.editions[0].edition_id,
        willRemove: g.editions.slice(1).map((e) => e.edition_id),
      })),
    });
  }

  // Perform merge: for each group, keep editions[0] (most recently updated), remove the rest
  const removed = [];
  const errors = [];

  for (const group of groups) {
    const [primary, ...duplicates] = group.editions;

    for (const dup of duplicates) {
      try {
        await pool.query('BEGIN');

        // Move cutoff_snapshots from duplicate edition to primary, skipping conflicts
        await pool.query(
          `
          insert into cutoff_snapshots (
            tournament_edition_id, event_type, draw_type, source_type,
            last_direct_acceptance_rank, last_direct_acceptance_player_name,
            last_alternate_rank, last_alternate_player_name,
            challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
            challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
            parsed_at, parser_version, source_notes, alternate_entries_count, updated_at
          )
          select
            $2::uuid, event_type, draw_type, source_type,
            last_direct_acceptance_rank, last_direct_acceptance_player_name,
            last_alternate_rank, last_alternate_player_name,
            challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
            challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
            parsed_at, parser_version, source_notes, alternate_entries_count, now()
          from cutoff_snapshots
          where tournament_edition_id = $1::uuid
          on conflict (tournament_edition_id, event_type, draw_type) do nothing
          `,
          [dup.edition_id, primary.edition_id]
        );

        // Delete duplicate edition's cutoff_snapshots
        await pool.query(
          'delete from cutoff_snapshots where tournament_edition_id = $1::uuid',
          [dup.edition_id]
        );

        // Delete the duplicate edition
        await pool.query(
          'delete from tournament_editions where id = $1::uuid',
          [dup.edition_id]
        );

        // Delete the duplicate tournament row if it has no more editions
        const editionCount = await pool.query<{ cnt: string }>(
          'select count(*) as cnt from tournament_editions where tournament_id = $1::uuid',
          [dup.tournament_id]
        );
        if (Number(editionCount.rows[0].cnt) === 0) {
          await pool.query('delete from tournaments where id = $1::uuid', [dup.tournament_id]);
        }

        await pool.query('COMMIT');
        removed.push({
          removedEditionId: dup.edition_id,
          removedSlug: dup.slug,
          keptEditionId: primary.edition_id,
          keptSlug: primary.slug,
          name: group.editions[0].name,
          calWeek: group.cal_week,
          year: group.year,
        });
      } catch (err) {
        await pool.query('ROLLBACK');
        errors.push({
          editionId: dup.edition_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    duplicateGroupCount: groups.length,
    removedCount: removed.length,
    errorCount: errors.length,
    removed,
    errors,
  });
}

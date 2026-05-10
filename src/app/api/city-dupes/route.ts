import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Finds tournament editions with matching city + calendar-week + year but different slugs.
// These are typically JeffSackmann imports that share a city with a canonical entry
// but have a different tournament name (e.g. "Baton Rouge" vs "Baton Rouge, LA",
// or "Montpellier" vs "Open Occitanie").
//
// ?dryRun=false merges cuts to the canonical (most-recently-updated) entry and deletes the ghost.

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';
  const yearParam = request.nextUrl.searchParams.get('year');

  let yearFilter = '';
  const queryParams: unknown[] = [];
  if (yearParam && ['2024', '2025', '2026'].includes(yearParam)) {
    queryParams.push(Number(yearParam));
    yearFilter = `and te.year = $1`;
  }

  const dupeQuery = await pool.query(
    `
    select
      t.city,
      date_trunc('week', te.start_date) as cal_week,
      te.year,
      count(*) as cnt,
      json_agg(json_build_object(
        'edition_id', te.id,
        'tournament_id', t.id,
        'slug', t.slug,
        'name', t.name,
        'city', t.city,
        'country', t.country,
        'start_date', te.start_date,
        'level', te.level,
        'source', te.source,
        'updated_at', te.updated_at,
        'cutoff_count', (select count(*) from cutoff_snapshots cs where cs.tournament_edition_id = te.id)
      ) order by te.updated_at desc nulls last) as editions
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.start_date is not null
      and t.city is not null
      ${yearFilter}
    group by t.city, date_trunc('week', te.start_date), te.year
    having count(*) > 1
    order by te.year, date_trunc('week', te.start_date), t.city
    `,
    queryParams
  );

  type EditionRef = {
    edition_id: string;
    tournament_id: string;
    slug: string;
    name: string;
    city: string;
    country: string | null;
    start_date: string;
    level: string;
    source: string;
    updated_at: string;
    cutoff_count: string;
  };

  const groups = dupeQuery.rows as Array<{
    city: string;
    cal_week: string;
    year: number;
    cnt: string;
    editions: EditionRef[];
  }>;

  if (dryRun || groups.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      duplicateGroupCount: groups.length,
      groups: groups.map((g) => ({
        city: g.city,
        calWeek: g.cal_week,
        year: g.year,
        count: Number(g.cnt),
        editions: g.editions,
        willKeep: g.editions[0].slug,
        willRemove: g.editions.slice(1).map((e) => e.slug),
      })),
    });
  }

  const removed = [];
  const errors = [];

  for (const group of groups) {
    const [primary, ...duplicates] = group.editions;

    for (const dup of duplicates) {
      try {
        await pool.query('BEGIN');

        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
           )
           select $2::uuid, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, now()
           from cutoff_snapshots
           where tournament_edition_id = $1::uuid
           on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
          [dup.edition_id, primary.edition_id]
        );

        await pool.query('delete from cutoff_snapshots where tournament_edition_id = $1::uuid', [dup.edition_id]);
        await pool.query('delete from tournament_editions where id = $1::uuid', [dup.edition_id]);

        const editionCount = await pool.query<{ cnt: string }>(
          'select count(*) as cnt from tournament_editions where tournament_id = $1::uuid',
          [dup.tournament_id]
        );
        if (Number(editionCount.rows[0].cnt) === 0) {
          await pool.query('delete from tournaments where id = $1::uuid', [dup.tournament_id]);
        }

        await pool.query('COMMIT');
        removed.push({
          removedSlug: dup.slug,
          removedName: dup.name,
          keptSlug: primary.slug,
          keptName: primary.name,
          city: group.city,
          year: group.year,
        });
      } catch (err) {
        await pool.query('ROLLBACK');
        errors.push({ slug: dup.slug, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    removedCount: removed.length,
    errorCount: errors.length,
    removed,
    errors,
  });
}

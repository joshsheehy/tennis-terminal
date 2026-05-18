import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NORMALIZE_SQL = (column: string) => `
  regexp_replace(
    regexp_replace(
      translate(lower(${column}), 'áàãâäéèêëíìîïóòõôöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
      '\\s+ch(\\s+\\d+)?$', ''
    ),
    '[^a-z0-9]+', '', 'g'
  )
`;

function candidateSql(year: number | null) {
  return `
    with exact_rows as (
      select
        te.id as exact_edition_id,
        te.tournament_id as exact_tournament_id,
        te.year,
        te.week,
        te.start_date,
        te.end_date,
        te.level,
        te.surface,
        te.indoor,
        te.source,
        te.source_url,
        t.slug as exact_slug,
        t.name as exact_name,
        t.city as exact_city,
        ${NORMALIZE_SQL('t.name')} as exact_name_key,
        ${NORMALIZE_SQL('t.city')} as exact_city_key
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      where te.status = 'held'
        and te.level ~* '^Challenger\\s+(50|75|100|125|175)$'
        and (te.source = 'atp_official_calendar_pdf' or te.source_url ilike '%calendar-pdfs%')
        ${year ? `and te.year = ${year}` : ''}
    ),
    generic_rows as (
      select
        te.id as generic_edition_id,
        te.tournament_id as generic_tournament_id,
        te.year,
        te.week,
        te.start_date,
        te.end_date,
        te.level,
        te.surface,
        te.indoor,
        te.source,
        te.source_url,
        t.slug as generic_slug,
        t.name as generic_name,
        t.city as generic_city,
        ${NORMALIZE_SQL('t.name')} as generic_name_key,
        ${NORMALIZE_SQL('t.city')} as generic_city_key
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      where te.status = 'held'
        and te.level = 'Challenger'
        ${year ? `and te.year = ${year}` : ''}
    ),
    base as (
      select
        e.*,
        g.generic_edition_id,
        g.generic_tournament_id,
        g.generic_slug,
        g.generic_name,
        g.generic_city,
        abs(e.start_date - g.start_date) as date_distance,
        row_number() over (
          partition by e.exact_edition_id
          order by
            case when e.exact_city_key = g.generic_city_key then 0 else 1 end,
            abs(e.start_date - g.start_date),
            g.generic_name
        ) as exact_rank
      from exact_rows e
      join generic_rows g on g.year = e.year
       and e.exact_edition_id <> g.generic_edition_id
       and abs(e.start_date - g.start_date) <= 28
       and (
         e.exact_city_key = g.generic_city_key
         or e.exact_name_key = g.generic_name_key
         or e.exact_name_key like '%' || g.generic_city_key || '%'
         or g.generic_name_key like '%' || e.exact_city_key || '%'
       )
    ),
    best_by_exact as (
      select * from base where exact_rank = 1
    ),
    ranked as (
      select *,
        row_number() over (
          partition by generic_edition_id
          order by date_distance, exact_name
        ) as generic_rank
      from best_by_exact
    )
    select * from ranked where generic_rank = 1
  `;
}

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : null;
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  if (year !== null && (!Number.isInteger(year) || year < 2024 || year > 2030)) {
    return NextResponse.json({ ok: false, error: 'year must be between 2024 and 2030' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`create temporary table challenger_level_merge_candidates on commit drop as ${candidateSql(year)}`);

    const candidates = await client.query(
      `select
         year,
         exact_name,
         exact_city,
         exact_slug,
         level as exact_level,
         start_date::text as exact_start_date,
         generic_name,
         generic_city,
         generic_slug,
         generic_edition_id,
         exact_edition_id,
         date_distance
       from challenger_level_merge_candidates
       order by year, exact_start_date, exact_name
       limit 50`
    );

    const countResult = await client.query<{ count: string }>(
      `select count(*)::text as count from challenger_level_merge_candidates`
    );
    const mergeCandidateCount = Number(countResult.rows[0]?.count ?? 0);

    if (!apply) {
      await client.query('rollback');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        year,
        mergeCandidateCount,
        sampleCandidates: candidates.rows,
      });
    }

    const movedCutoffs = await client.query(
      `insert into cutoff_snapshots (
         tournament_edition_id,
         event_type,
         draw_type,
         source_type,
         last_direct_acceptance_rank,
         last_direct_acceptance_player_name,
         last_alternate_rank,
         last_alternate_player_name,
         challenger_doubles_advanced_cut_rank,
         challenger_doubles_advanced_team_name,
         challenger_doubles_onsite_cut_rank,
         challenger_doubles_onsite_team_name,
         parsed_at,
         parser_version,
         source_notes,
         alternate_entries_count,
         lucky_loser_count,
         updated_at
       )
       select
         c.generic_edition_id,
         cs.event_type,
         cs.draw_type,
         cs.source_type,
         cs.last_direct_acceptance_rank,
         cs.last_direct_acceptance_player_name,
         cs.last_alternate_rank,
         cs.last_alternate_player_name,
         cs.challenger_doubles_advanced_cut_rank,
         cs.challenger_doubles_advanced_team_name,
         cs.challenger_doubles_onsite_cut_rank,
         cs.challenger_doubles_onsite_team_name,
         cs.parsed_at,
         cs.parser_version,
         cs.source_notes,
         cs.alternate_entries_count,
         cs.lucky_loser_count,
         now()
       from challenger_level_merge_candidates c
       join cutoff_snapshots cs on cs.tournament_edition_id = c.exact_edition_id
       where not exists (
         select 1 from cutoff_snapshots existing
         where existing.tournament_edition_id = c.generic_edition_id
           and existing.event_type = cs.event_type
           and existing.draw_type = cs.draw_type
       )`
    );

    const updatedGenericEditions = await client.query(
      `update tournament_editions generic
       set
         week = exact.week,
         start_date = exact.start_date,
         end_date = exact.end_date,
         level = exact.level,
         surface = exact.surface,
         indoor = exact.indoor,
         source = 'atp_official_calendar_pdf_merged',
         source_url = case
           when generic.source_url is null or generic.source_url = '' then exact.source_url
           when exact.source_url is null or exact.source_url = '' then generic.source_url
           when generic.source_url ilike '%' || exact.source_url || '%' then generic.source_url
           else generic.source_url || ' | ' || exact.source_url
         end,
         updated_at = now()
       from challenger_level_merge_candidates c
       join tournament_editions exact on exact.id = c.exact_edition_id
       where generic.id = c.generic_edition_id`
    );

    const deletedExactEditions = await client.query(
      `delete from tournament_editions te
       using challenger_level_merge_candidates c
       where te.id = c.exact_edition_id`
    );

    const deletedOrphanTournaments = await client.query(
      `delete from tournaments t
       where not exists (
         select 1 from tournament_editions te where te.tournament_id = t.id
       )`
    );

    await client.query('commit');

    return NextResponse.json({
      ok: true,
      dryRun: false,
      year,
      mergeCandidateCount,
      movedCutoffCount: movedCutoffs.rowCount ?? 0,
      updatedGenericEditionCount: updatedGenericEditions.rowCount ?? 0,
      deletedDuplicateEditionCount: deletedExactEditions.rowCount ?? 0,
      deletedOrphanTournamentCount: deletedOrphanTournaments.rowCount ?? 0,
      sampleCandidates: candidates.rows,
    });
  } catch (error) {
    await client.query('rollback');
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

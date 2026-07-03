import { EARLIEST_SEASON } from '@/lib/seasons';
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

const BASE_SQL = (column: string) => `regexp_replace(${NORMALIZE_SQL(column)}, '\\d+$', '')`;

function candidatesSql(year: number | null, slug: string | null) {
  return `
    with generic_rows as (
      select
        te.id as generic_edition_id,
        te.tournament_id as generic_tournament_id,
        te.year,
        te.week as generic_week,
        te.start_date as generic_start_date,
        te.level as generic_level,
        te.surface as generic_surface,
        te.indoor as generic_indoor,
        te.source_url as generic_source_url,
        t.slug as generic_slug,
        t.name as generic_name,
        t.city as generic_city,
        ${NORMALIZE_SQL('t.slug')} as generic_slug_key,
        ${NORMALIZE_SQL('t.name')} as generic_name_key,
        ${NORMALIZE_SQL('t.city')} as generic_city_key,
        ${BASE_SQL('t.slug')} as generic_slug_base,
        ${BASE_SQL('t.name')} as generic_name_base,
        ${BASE_SQL('t.city')} as generic_city_base,
        (t.slug ~ '\\d' or t.name ~ '\\d' or t.city ~ '\\d') as generic_has_digit
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      where te.status = 'held'
        and te.level = 'Challenger'
        and te.start_date is not null
        ${year ? `and te.year = ${year}` : ''}
        ${slug ? `and t.slug = '${slug.replace(/'/g, "''")}'` : ''}
    ),
    exact_rows as (
      select
        te.id as exact_edition_id,
        te.tournament_id as exact_tournament_id,
        te.year,
        te.week as exact_week,
        te.start_date as exact_start_date,
        te.level as exact_level,
        te.surface as exact_surface,
        te.indoor as exact_indoor,
        te.source_url as exact_source_url,
        t.slug as exact_slug,
        t.name as exact_name,
        t.city as exact_city,
        ${NORMALIZE_SQL('t.slug')} as exact_slug_key,
        ${NORMALIZE_SQL('t.name')} as exact_name_key,
        ${NORMALIZE_SQL('t.city')} as exact_city_key,
        ${BASE_SQL('t.slug')} as exact_slug_base,
        ${BASE_SQL('t.name')} as exact_name_base,
        ${BASE_SQL('t.city')} as exact_city_base,
        (t.slug ~ '\\d' or t.name ~ '\\d' or t.city ~ '\\d') as exact_has_digit
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      where te.status = 'held'
        and te.level ~* '^Challenger\\s+(50|75|100|125|175)$'
        and te.start_date is not null
        ${year ? `and te.year = ${year}` : ''}
    ),
    scored as (
      select
        g.*,
        e.exact_edition_id,
        e.exact_tournament_id,
        e.exact_week,
        e.exact_start_date,
        e.exact_level,
        e.exact_surface,
        e.exact_indoor,
        e.exact_source_url,
        e.exact_slug,
        e.exact_name,
        e.exact_city,
        abs(e.exact_start_date - g.generic_start_date) as date_distance,
        case
          when abs(e.exact_start_date - g.generic_start_date) <= 7 and e.exact_slug_key = g.generic_slug_key then 100
          when abs(e.exact_start_date - g.generic_start_date) <= 7 and e.exact_name_key = g.generic_name_key then 95
          when abs(e.exact_start_date - g.generic_start_date) <= 7 and e.exact_city_key = g.generic_city_key and not e.exact_has_digit and not g.generic_has_digit then 90
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and e.exact_slug_base = g.generic_slug_base then 80
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and e.exact_name_base = g.generic_name_base then 78
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and e.exact_city_base = g.generic_city_base then 76
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and length(e.exact_slug_base) >= 5 and length(g.generic_slug_base) >= 5 and (e.exact_slug_base like '%' || g.generic_slug_base || '%' or g.generic_slug_base like '%' || e.exact_slug_base || '%') then 70
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and length(e.exact_name_base) >= 5 and length(g.generic_name_base) >= 5 and (e.exact_name_base like '%' || g.generic_name_base || '%' or g.generic_name_base like '%' || e.exact_name_base || '%') then 68
          when abs(e.exact_start_date - g.generic_start_date) <= 120 and not e.exact_has_digit and not g.generic_has_digit and length(e.exact_city_base) >= 5 and length(g.generic_city_base) >= 5 and (e.exact_city_base like '%' || g.generic_city_base || '%' or g.generic_city_base like '%' || e.exact_city_base || '%') then 66
          else -1
        end as match_score
      from generic_rows g
      join exact_rows e on e.year = g.year and e.exact_edition_id <> g.generic_edition_id
    ),
    ranked as (
      select *, row_number() over (
        partition by generic_edition_id
        order by match_score desc, date_distance asc, exact_name asc
      ) as rn
      from scored
      where match_score >= 0
    )
    select * from ranked where rn = 1
  `;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : null;
  const slug = params.get('slug');
  const apply = params.get('apply') === 'true';

  if (year !== null && (!Number.isInteger(year) || year < EARLIEST_SEASON || year > 2030)) {
    return NextResponse.json({ ok: false, error: 'year must be between 2024 and 2030' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`create temporary table challenger_level_candidates on commit drop as ${candidatesSql(year, slug)}`);

    const sample = await client.query(
      `select
         year,
         generic_slug,
         generic_name,
         generic_city,
         generic_start_date::text as generic_start_date,
         generic_level,
         exact_slug,
         exact_name,
         exact_city,
         exact_start_date::text as exact_start_date,
         exact_level,
         match_score,
         date_distance
       from challenger_level_candidates
       order by year, generic_start_date, generic_name
       limit 75`
    );

    const countResult = await client.query<{ count: string }>('select count(*)::text as count from challenger_level_candidates');
    const candidateCount = Number(countResult.rows[0]?.count ?? 0);

    if (!apply) {
      await client.query('rollback');
      return NextResponse.json({ ok: true, dryRun: true, year, slug, candidateCount, sampleCandidates: sample.rows });
    }

    const updateResult = await client.query(
      `update tournament_editions generic
       set
         week = c.exact_week,
         start_date = c.exact_start_date,
         level = c.exact_level,
         surface = c.exact_surface,
         indoor = c.exact_indoor,
         source = 'official_challenger_level_promoted',
         source_url = case
           when generic.source_url is null or generic.source_url = '' then c.exact_source_url
           when c.exact_source_url is null or c.exact_source_url = '' then generic.source_url
           when generic.source_url ilike '%' || c.exact_source_url || '%' then generic.source_url
           else generic.source_url || ' | ' || c.exact_source_url
         end,
         updated_at = now()
       from challenger_level_candidates c
       where generic.id = c.generic_edition_id`
    );

    await client.query('commit');
    return NextResponse.json({
      ok: true,
      dryRun: false,
      year,
      slug,
      candidateCount,
      updatedCount: updateResult.rowCount ?? 0,
      sampleCandidates: sample.rows,
    });
  } catch (error) {
    await client.query('rollback');
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    client.release();
  }
}

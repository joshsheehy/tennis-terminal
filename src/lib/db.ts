import { Pool, PoolClient } from 'pg';
import { CutoffSnapshot, ScheduleRow } from './types';
import { getAtpWeekForSeason } from './atp-week';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing');
}

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

// Run `fn` inside a real BEGIN/COMMIT on a single checked-out client.
// Never use pool.query('BEGIN') for this: each pool.query() call can run on
// a different pooled connection, so the BEGIN, the statements, and the
// COMMIT are not guaranteed to share a transaction at all.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection-level failure; release() below discards the client.
    }
    throw err;
  } finally {
    client.release();
  }
}

export type TournamentDetailRow = {
  edition: ScheduleRow;
  cutoffs: CutoffSnapshot[];
  same_level_as_previous_year: boolean | null;
  same_week_as_previous_year: boolean | null;
};

const STRICT_TOURNAMENT_KEY_SQL = (column: string) => `
  regexp_replace(
    regexp_replace(
      translate(lower(${column}), 'áàãâäéèêëíìîïóòõôöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
      '\\s+ch(\\s+\\d+)?$', ''
    ),
    '[^a-z0-9]+', '', 'g'
  )
`;

const BASE_TOURNAMENT_KEY_SQL = (column: string) => `
  regexp_replace(
    ${STRICT_TOURNAMENT_KEY_SQL(column)},
    '\\d+$', ''
  )
`;

const HAS_DIGIT_SQL = (column: string) => `${column} ~ '\\d'`;
const NON_EMPTY_CONTAINS_SQL = (left: string, right: string) => `
  length(${left}) >= 5
  and length(${right}) >= 5
  and (${left} like '%' || ${right} || '%' or ${right} like '%' || ${left} || '%')
`;

// Overlay exact Challenger levels (Challenger 50/75/100/125/175) on older
// generic Challenger rows for display. This is intentionally read-only: it
// does not merge/delete rows, so bad fuzzy matches cannot destroy cut data.
const EXACT_CHALLENGER_LEVEL_JOIN_SQL = `
  left join lateral (
    select
      te2.level,
      te2.week,
      te2.start_date,
      te2.surface,
      te2.indoor
    from tournament_editions te2
    join tournaments t2 on t2.id = te2.tournament_id
    where te.level = 'Challenger'
      and te2.status = 'held'
      and te2.year = te.year
      and te2.id <> te.id
      and te2.level ~* '^Challenger\\s+(50|75|100|125|175)$'
      and (
        (
          abs(te2.start_date - te.start_date) <= 7
          and (
            ${STRICT_TOURNAMENT_KEY_SQL('t2.slug')} = ${STRICT_TOURNAMENT_KEY_SQL('t.slug')}
            or ${STRICT_TOURNAMENT_KEY_SQL('t2.name')} = ${STRICT_TOURNAMENT_KEY_SQL('t.name')}
            or ${STRICT_TOURNAMENT_KEY_SQL('t2.city')} = ${STRICT_TOURNAMENT_KEY_SQL('t.city')}
          )
        )
        or (
          abs(te2.start_date - te.start_date) <= 120
          and not ${HAS_DIGIT_SQL('t.name')}
          and not ${HAS_DIGIT_SQL('t2.name')}
          and not ${HAS_DIGIT_SQL('t.slug')}
          and not ${HAS_DIGIT_SQL('t2.slug')}
          and (
            ${BASE_TOURNAMENT_KEY_SQL('t2.slug')} = ${BASE_TOURNAMENT_KEY_SQL('t.slug')}
            or ${BASE_TOURNAMENT_KEY_SQL('t2.name')} = ${BASE_TOURNAMENT_KEY_SQL('t.name')}
            or ${BASE_TOURNAMENT_KEY_SQL('t2.city')} = ${BASE_TOURNAMENT_KEY_SQL('t.city')}
            or ${NON_EMPTY_CONTAINS_SQL(BASE_TOURNAMENT_KEY_SQL('t2.slug'), BASE_TOURNAMENT_KEY_SQL('t.slug'))}
            or ${NON_EMPTY_CONTAINS_SQL(BASE_TOURNAMENT_KEY_SQL('t2.name'), BASE_TOURNAMENT_KEY_SQL('t.name'))}
            or ${NON_EMPTY_CONTAINS_SQL(BASE_TOURNAMENT_KEY_SQL('t2.city'), BASE_TOURNAMENT_KEY_SQL('t.city'))}
          )
        )
      )
    order by
      case
        when ${STRICT_TOURNAMENT_KEY_SQL('t2.slug')} = ${STRICT_TOURNAMENT_KEY_SQL('t.slug')} then 0
        when ${STRICT_TOURNAMENT_KEY_SQL('t2.name')} = ${STRICT_TOURNAMENT_KEY_SQL('t.name')} then 1
        when ${STRICT_TOURNAMENT_KEY_SQL('t2.city')} = ${STRICT_TOURNAMENT_KEY_SQL('t.city')} then 2
        when ${BASE_TOURNAMENT_KEY_SQL('t2.slug')} = ${BASE_TOURNAMENT_KEY_SQL('t.slug')} then 3
        when ${BASE_TOURNAMENT_KEY_SQL('t2.name')} = ${BASE_TOURNAMENT_KEY_SQL('t.name')} then 4
        when ${BASE_TOURNAMENT_KEY_SQL('t2.city')} = ${BASE_TOURNAMENT_KEY_SQL('t.city')} then 5
        else 6
      end,
      abs(te2.start_date - te.start_date),
      te2.updated_at desc nulls last
    limit 1
  ) exact_challenger on true
`;

export async function getScheduleForYear(year: number): Promise<ScheduleRow[]> {
  const result = await pool.query<ScheduleRow>(
    `
    with ranked as (
      select
        te.id as edition_id,
        t.id as tournament_id,
        t.slug,
        t.name,
        t.city,
        t.country,
        te.year,
        coalesce(exact_challenger.week, te.week) as week,
        coalesce(exact_challenger.start_date, te.start_date) as start_date,
        te.end_date,
        coalesce(exact_challenger.level, te.level) as level,
        coalesce(exact_challenger.surface, te.surface) as surface,
        coalesce(exact_challenger.indoor, te.indoor) as indoor,
        te.source,
        te.status,
        row_number() over (
          -- Deduplicate by calendar week so JeffSackmann imports (stored week may differ)
          -- collapse with canonical entries. Strip " ch N" and trailing " N" from names.
          partition by
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  translate(lower(t.name), 'áàãâäéèêëíìîïóòõôöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
                  '\\s+ch(\\s+\\d+)?$', ''
                ),
                '\\s+\\d+$', ''
              ),
              ',\\s*[a-z]{2}$', ''
            ),
            date_trunc('week', te.start_date)
          order by te.updated_at desc nulls last
        ) as rn
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      ${EXACT_CHALLENGER_LEVEL_JOIN_SQL}
      where te.status = 'held'
        and te.year = $1
        and te.start_date is not null
        -- Keep only dates that belong to the selected ATP season:
        -- normal rows start in the same calendar year, while Week 1 carryover
        -- rows may start in December of the previous calendar year.
        -- This blocks stale rows such as year=2026 with start_date='2025-03-17'.
        and (
          (
            extract(year from te.start_date) = te.year
            and extract(month from te.start_date) <> 12
          )
          or (
            extract(year from te.start_date) = te.year - 1
            and extract(month from te.start_date) = 12
          )
        )
    )
    select edition_id, tournament_id, slug, name, city, country,
           year, week, start_date, end_date, level, surface, indoor, source, status
    from ranked
    where rn = 1
    order by start_date asc, name asc
    `,
    [year]
  );

  return result.rows.map((row) => ({
    ...row,
    // Always recalculate the display week from the date + ATP season year.
    // This fixes bad stored historical weeks like Jan 6 showing in Week 1,
    // while the SQL season-date filter above prevents stale wrong-year rows.
    week: getAtpWeekForSeason(row.start_date, row.year) ?? row.week,
  }));
}

export async function getTournamentHistoryBySlug(
  slug: string
): Promise<ScheduleRow[]> {
  const result = await pool.query<ScheduleRow>(
    `
    select
      te.id as edition_id,
      t.id as tournament_id,
      t.slug,
      t.name,
      t.city,
      t.country,
      te.year,
      te.week,
      te.start_date,
      te.end_date,
      te.level,
      te.surface,
      te.indoor,
      te.source,
      te.status
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
      and te.status = 'held'
    order by te.year desc
    `,
    [slug]
  );

  return result.rows;
}

export async function getCutoffSnapshotsForEditionIds(
  editionIds: string[]
): Promise<CutoffSnapshot[]> {
  if (editionIds.length === 0) return [];

  const result = await pool.query<CutoffSnapshot>(
    `
    select
      id,
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
      created_at,
      updated_at
    from cutoff_snapshots
    where tournament_edition_id = any($1::uuid[])
    order by tournament_edition_id, event_type, draw_type
    `,
    [editionIds]
  );

  return result.rows;
}

export async function getTournamentDetailRowsBySlug(
  slug: string,
  limit = 4,
  maxYear = 9999
): Promise<TournamentDetailRow[]> {
  const editionsResult = await pool.query<ScheduleRow>(
    `
    select
      te.id as edition_id,
      t.id as tournament_id,
      t.slug,
      t.name,
      t.city,
      t.country,
      te.year,
      coalesce(exact_challenger.week, te.week) as week,
      coalesce(exact_challenger.start_date, te.start_date) as start_date,
      te.end_date,
      coalesce(exact_challenger.level, te.level) as level,
      coalesce(exact_challenger.surface, te.surface) as surface,
      coalesce(exact_challenger.indoor, te.indoor) as indoor,
      te.source,
      te.status
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    ${EXACT_CHALLENGER_LEVEL_JOIN_SQL}
    where t.slug = $1
      and te.year <= $3
      and te.start_date is not null
      and (
        (
          extract(year from te.start_date) = te.year
          and extract(month from te.start_date) <> 12
        )
        or (
          extract(year from te.start_date) = te.year - 1
          and extract(month from te.start_date) = 12
        )
      )
    order by te.year desc
    limit $2
    `,
    [slug, limit, maxYear]
  );

  const editions = editionsResult.rows.map((row) => ({
    ...row,
    week: getAtpWeekForSeason(row.start_date, row.year) ?? row.week,
  }));
  const editionIds = editions.map((edition) => edition.edition_id);
  const cutoffs = await getCutoffSnapshotsForEditionIds(editionIds);

  return editions.map((edition, index) => {
    const previousEdition = editions[index + 1] ?? null;

    return {
      edition,
      cutoffs: cutoffs.filter(
        (cutoff) => cutoff.tournament_edition_id === edition.edition_id
      ),
      same_level_as_previous_year: previousEdition
        ? edition.level === previousEdition.level
        : null,
      same_week_as_previous_year: previousEdition
        ? edition.week === previousEdition.week
        : null,
    };
  });
}

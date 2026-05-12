import { Pool } from 'pg';
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

export type TournamentDetailRow = {
  edition: ScheduleRow;
  cutoffs: CutoffSnapshot[];
  same_level_as_previous_year: boolean | null;
  same_week_as_previous_year: boolean | null;
};

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
        te.week,
        te.start_date,
        te.end_date,
        te.level,
        te.surface,
        te.indoor,
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
      where te.status = 'held'
        and te.year = $1
        and te.start_date is not null
        -- Exclude editions where start_date is in December of the same calendar year as
        -- te.year — those are bad records (e.g. year=2025, start='2025-12-30', week=53).
        -- December starts that belong to the NEXT ATP year (e.g. year=2026, start='2025-12-30')
        -- are kept and correctly compute to week 1.
        and not (
          extract(month from te.start_date) = 12
          and extract(year from te.start_date) = te.year
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
      and te.year <= $3
      and te.start_date is not null
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

import { Pool } from 'pg';
import { CutoffDisplayRow, CutoffSnapshot, ScheduleRow } from './types';

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

export async function getUpcomingSchedule(limit = 20): Promise<ScheduleRow[]> {
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
    where te.status = 'held'
    order by te.start_date asc, t.name asc
    limit $1
    `,
    [limit]
  );

  return result.rows;
}

export async function getTournamentHistoryBySlug(slug: string): Promise<ScheduleRow[]> {
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
    select *
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
  historyYears = 3
): Promise<CutoffDisplayRow[]> {
  const allEditions = await getTournamentHistoryBySlug(slug);
  if (allEditions.length === 0) return [];

  const currentYear = Math.max(...allEditions.map((edition) => edition.year));
  const minYear = currentYear - historyYears;
  const visibleEditions = allEditions.filter(
    (edition) => edition.year <= currentYear && edition.year >= minYear
  );

  const cutoffs = await getCutoffSnapshotsForEditionIds(
    visibleEditions.map((edition) => edition.edition_id)
  );

  const editionsByYear = new Map(allEditions.map((edition) => [edition.year, edition]));

  return visibleEditions.map((edition) => {
    const previousEdition = editionsByYear.get(edition.year - 1) ?? null;

    return {
      edition,
      previous_year: previousEdition?.year ?? null,
      same_level_as_previous_year: previousEdition
        ? previousEdition.level === edition.level
        : null,
      same_week_as_previous_year: previousEdition
        ? previousEdition.week === edition.week
        : null,
      cutoffs: cutoffs.filter(
        (cutoff) => cutoff.tournament_edition_id === edition.edition_id
      ),
    };
  });
}

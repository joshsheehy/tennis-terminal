import { Pool } from 'pg';
import { CutoffSnapshot, ScheduleRow } from './types';

const connectionString = process.env.DATABASE_URL;

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

export async function getUpcomingSchedule(limit = 20): Promise<ScheduleRow[]> {
  if (!connectionString) return [];

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
      te.source
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

export async function getEditionBySlug(slug: string): Promise<ScheduleRow | null> {
  if (!connectionString) return null;

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
      te.source
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
    order by te.year desc
    limit 1
    `,
    [slug]
  );

  return result.rows[0] ?? null;
}

export async function getCutoffSnapshot(
  tournamentEditionId: string,
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying'
): Promise<CutoffSnapshot | null> {
  if (!connectionString) return null;

  const result = await pool.query<CutoffSnapshot>(
    `
    select *
    from cutoff_snapshots
    where tournament_edition_id = $1
      and event_type = $2
      and draw_type = $3
    limit 1
    `,
    [tournamentEditionId, eventType, drawType]
  );

  return result.rows[0] ?? null;
}

import { pool } from './db';
import type { NewTournament } from './new-tournament-message';

// Which ATP/Challenger editions have already been announced on Telegram.
// Every importer (official calendar, catalogue sync, ProTennisLive postings,
// hand-entered rows) can add an edition, so rather than hooking each one,
// /api/announce-new-tournaments compares what's on the site with this table.
// Created lazily; sql/022_create_tournament_announcements.sql is the schema of record.

let ensured: Promise<void> | null = null;

export function ensureAnnouncementsTable(): Promise<void> {
  ensured ??= pool
    .query(
      `create table if not exists tournament_announcements (
         edition_id uuid primary key references tournament_editions(id) on delete cascade,
         announced_at timestamptz not null default now(),
         baseline boolean not null default false
       )`
    )
    .then(() => undefined)
    .catch((error) => {
      ensured = null;
      throw error;
    });
  return ensured;
}

// Held ATP and Challenger main-draw editions from last week on. Past seasons
// being backfilled, ITF events and Slam qualifying aren't "new tournaments".
const UPCOMING_TOUR_LEVEL = `
  te.level not ilike 'ITF%'
  and te.level not ilike '%qualifying%'
  and te.start_date >= current_date - 7`;
const ANNOUNCEABLE = `te.status = 'held' and ${UPCOMING_TOUR_LEVEL}`;

export async function hasAnnouncedBefore(): Promise<boolean> {
  await ensureAnnouncementsTable();
  const result = await pool.query(`select 1 from tournament_announcements limit 1`);
  return (result.rowCount ?? 0) > 0;
}

/**
 * First run: record everything already on the site, so only later additions
 * are announced. Hidden editions too — data-sync's 2026 sweep hides rows
 * mid-run and restores them at the end, and one restored after the baseline
 * would otherwise be announced as new.
 */
export async function recordBaseline(): Promise<number> {
  await ensureAnnouncementsTable();
  const result = await pool.query(
    `insert into tournament_announcements (edition_id, baseline)
     select te.id, true from tournament_editions te
     where ${UPCOMING_TOUR_LEVEL}
     on conflict (edition_id) do nothing`
  );
  return result.rowCount ?? 0;
}

export async function unannouncedTournaments(): Promise<Array<NewTournament & { editionId: string }>> {
  await ensureAnnouncementsTable();
  const result = await pool.query<NewTournament & { editionId: string }>(
    `select te.id as "editionId", t.slug, t.name, t.city, t.country, te.level,
            te.start_date::text as "startDate", te.year
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     left join tournament_announcements ta on ta.edition_id = te.id
     where ${ANNOUNCEABLE} and ta.edition_id is null
     order by te.start_date, t.name`
  );
  return result.rows;
}

export async function markAnnounced(editionIds: string[]): Promise<void> {
  if (editionIds.length === 0) return;
  await pool.query(
    `insert into tournament_announcements (edition_id)
     select unnest($1::uuid[])
     on conflict (edition_id) do nothing`,
    [editionIds]
  );
}

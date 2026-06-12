// Data plumbing for swing detection (phase 2): loads a year's events for the
// pure detector and persists results to the additive swings tables. Reuses
// getScheduleForYear for its dedupe + week recomputation instead of forking
// that logic; existing queries are not modified.

import type { Pool } from 'pg';
import { getScheduleForYear, withTransaction } from './db';
import {
  DEFAULT_SWING_CONFIG,
  DetectedSwing,
  SwingConfig,
  SwingEventInput,
  detectSwings,
} from './swings';

// The swings feature covers ATP + Challenger only; ITF events stay out of
// detection even though they exist in the database.
function isSwingLevel(level: string): boolean {
  return !/^itf/i.test(level.trim());
}

function isoDate(value: unknown): string {
  // pg returns date columns as Date objects despite the string type on
  // ScheduleRow; String(Date) is not ISO, so handle both shapes.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function loadSwingEventsForYear(
  pool: Pool,
  year: number
): Promise<SwingEventInput[]> {
  const schedule = await getScheduleForYear(year);
  const rows = schedule.filter(
    (row) => isSwingLevel(row.level) && Number.isInteger(row.week)
  );

  const tournamentIds = [...new Set(rows.map((row) => row.tournament_id))];
  const coordsResult = await pool.query<{
    id: string;
    latitude: number | null;
    longitude: number | null;
  }>(
    'select id, latitude, longitude from tournaments where id = any($1::uuid[])',
    [tournamentIds]
  );
  const coords = new Map(coordsResult.rows.map((row) => [row.id, row]));

  return rows.map((row) => ({
    editionId: row.edition_id,
    tournamentId: row.tournament_id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    country: row.country,
    latitude: coords.get(row.tournament_id)?.latitude ?? null,
    longitude: coords.get(row.tournament_id)?.longitude ?? null,
    week: row.week!,
    startDate: isoDate(row.start_date),
    level: row.level,
    surface: row.surface,
    indoor: row.indoor,
  }));
}

// Matches sql/007_create_swings.sql; idempotent here so the deployed app can
// bring production up to date (the /api/setup pattern).
export async function ensureSwingTables(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists swings (
      id uuid primary key default gen_random_uuid(),
      year int not null,
      label text not null,
      start_week int not null,
      end_week int not null,
      total_weeks int not null,
      surface_consistent boolean not null,
      surfaces text[] not null,
      tier_mix text not null,
      countries text[] not null,
      computed_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists swing_events (
      id uuid primary key default gen_random_uuid(),
      swing_id uuid not null references swings(id) on delete cascade,
      tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
      week int not null,
      position int not null,
      created_at timestamptz not null default now(),
      unique (swing_id, tournament_edition_id)
    );
  `);
  await pool.query(`
    create index if not exists swings_year_idx on swings(year);
    create index if not exists swing_events_swing_idx on swing_events(swing_id);
    create index if not exists swing_events_edition_idx on swing_events(tournament_edition_id);
  `);
}

export type RecomputeSummary = {
  year: number;
  eventCount: number;
  swings: DetectedSwing[];
  persisted: boolean;
};

/**
 * Detect swings for a year; when `persist` is set, replace that year's rows
 * in the swings tables atomically (other years are untouched).
 */
export async function recomputeSwingsForYear(
  pool: Pool,
  year: number,
  options: { persist: boolean; config?: SwingConfig }
): Promise<RecomputeSummary> {
  const config = options.config ?? DEFAULT_SWING_CONFIG;
  const events = await loadSwingEventsForYear(pool, year);
  const swings = detectSwings(events, config);

  if (options.persist) {
    await ensureSwingTables(pool);
    await withTransaction(async (client) => {
      await client.query('delete from swings where year = $1', [year]);
      for (const swing of swings) {
        const inserted = await client.query<{ id: string }>(
          `insert into swings
             (year, label, start_week, end_week, total_weeks,
              surface_consistent, surfaces, tier_mix, countries, computed_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
           returning id`,
          [
            year,
            swing.label,
            swing.startWeek,
            swing.endWeek,
            swing.totalWeeks,
            swing.surfaceConsistent,
            swing.surfaces,
            swing.tierMix,
            swing.countries,
          ]
        );
        const swingId = inserted.rows[0].id;
        let position = 0;
        for (const week of swing.weeks) {
          for (const event of week.events) {
            await client.query(
              `insert into swing_events (swing_id, tournament_edition_id, week, position)
               values ($1, $2, $3, $4)`,
              [swingId, event.editionId, week.week, position]
            );
            position += 1;
          }
        }
      }
    });
  }

  return { year, eventCount: events.length, swings, persisted: options.persist };
}

/** Compact, readable description of one swing (sanity output + API). */
export function describeSwing(swing: DetectedSwing): {
  label: string;
  weeks: string;
  totalWeeks: number;
  countries: string[];
  surfaces: string[];
  surfaceConsistent: boolean;
  tierMix: string;
  itinerary: string[];
} {
  return {
    label: swing.label,
    weeks: `W${swing.startWeek}–W${swing.endWeek}`,
    totalWeeks: swing.totalWeeks,
    countries: swing.countries,
    surfaces: swing.surfaces,
    surfaceConsistent: swing.surfaceConsistent,
    tierMix: swing.tierMix,
    itinerary: swing.weeks.flatMap((week) =>
      week.events.map(
        (event) =>
          `W${week.week} · ${event.name} (${event.city}) · ${event.level} · ${event.surface}`
      )
    ),
  };
}

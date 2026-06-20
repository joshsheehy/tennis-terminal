// Data plumbing for swing detection (phase 2): loads a year's events for the
// pure detector and persists results to the additive swings tables. Reuses
// getScheduleForYear for its dedupe + week recomputation instead of forking
// that logic; existing queries are not modified.

import type { Pool } from 'pg';
import { getScheduleForYear, withTransaction } from './db';
import {
  DEFAULT_LEVEL_SCOPE,
  DEFAULT_SWING_CONFIG,
  DetectedSwing,
  LevelGroup,
  SwingConfig,
  SwingEventInput,
  allLevelScopes,
  detectSwings,
  levelGroup,
  scopeKey,
} from './swings';

function isoDate(value: unknown): string {
  // pg returns date columns as Date objects despite the string type on
  // ScheduleRow; String(Date) is not ISO, so handle both shapes.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Load every classifiable event (ATP, Challenger, ITF) for a year, tagged via
 * the existing deduped schedule query. The caller filters by level scope; ITF
 * is included here so an all-levels view is possible.
 */
export async function loadSwingEventsForYear(
  pool: Pool,
  year: number
): Promise<SwingEventInput[]> {
  const schedule = await getScheduleForYear(year);
  const rows = schedule.filter(
    (row) => levelGroup(row.level) !== null && Number.isInteger(row.week)
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

// Matches sql/007_create_swings.sql + sql/008_add_swing_level_scope.sql;
// idempotent here so the deployed app can bring production up to date (the
// /api/setup pattern).
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
  // level_scope distinguishes the same year's swings computed for different
  // level filters (e.g. 'atp+challenger' vs 'atp+challenger+itf').
  await pool.query(
    `alter table swings add column if not exists level_scope text not null default 'atp+challenger'`
  );
  // 'swing' (travel chain) vs 'series' (single-city residency).
  await pool.query(`alter table swings add column if not exists kind text not null default 'swing'`);
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
    create index if not exists swings_year_scope_idx on swings(year, level_scope);
    create index if not exists swing_events_swing_idx on swing_events(swing_id);
    create index if not exists swing_events_edition_idx on swing_events(tournament_edition_id);
  `);
}

export type ScopeSummary = {
  scope: LevelGroup[];
  scopeKey: string;
  eventCount: number;
  swings: DetectedSwing[];
};

export type RecomputeSummary = {
  year: number;
  totalEventCount: number;
  persisted: boolean;
  scopes: ScopeSummary[];
};

function eventsInScope(events: SwingEventInput[], scope: LevelGroup[]): SwingEventInput[] {
  const groups = new Set(scope);
  return events.filter((event) => {
    const group = levelGroup(event.level);
    return group !== null && groups.has(group);
  });
}

async function persistScope(
  pool: Pool,
  year: number,
  key: string,
  swings: DetectedSwing[]
): Promise<void> {
  // One transaction per scope keeps each write bounded. swing_events for a
  // swing are inserted in a single multi-row statement to cut round-trips.
  await withTransaction(async (client) => {
    await client.query('delete from swings where year = $1 and level_scope = $2', [year, key]);
    for (const swing of swings) {
      const inserted = await client.query<{ id: string }>(
        `insert into swings
           (year, level_scope, kind, label, start_week, end_week, total_weeks,
            surface_consistent, surfaces, tier_mix, countries, computed_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
         returning id`,
        [
          year,
          key,
          swing.kind,
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

      const tuples: string[] = [];
      const params: unknown[] = [swingId];
      let p = 2;
      let position = 0;
      for (const week of swing.weeks) {
        for (const event of week.events) {
          tuples.push(`($1, $${p++}, $${p++}, $${p++})`);
          params.push(event.editionId, week.week, position);
          position += 1;
        }
      }
      if (tuples.length > 0) {
        await client.query(
          `insert into swing_events (swing_id, tournament_edition_id, week, position)
           values ${tuples.join(', ')}`,
          params
        );
      }
    }
  });
}

/**
 * Detect swings for a year across one or more level scopes; when `persist` is
 * set, replace each scope's rows for that year (other years/scopes untouched).
 * Defaults to all seven non-empty level scopes.
 */
export async function recomputeSwingsForYear(
  pool: Pool,
  year: number,
  options: { persist: boolean; config?: SwingConfig; scopes?: LevelGroup[][] }
): Promise<RecomputeSummary> {
  const config = options.config ?? DEFAULT_SWING_CONFIG;
  const scopeList = options.scopes ?? allLevelScopes();
  const events = await loadSwingEventsForYear(pool, year);

  if (options.persist) await ensureSwingTables(pool);

  const scopes: ScopeSummary[] = [];
  for (const scope of scopeList) {
    const key = scopeKey(scope);
    const scoped = eventsInScope(events, scope);
    const swings = detectSwings(scoped, config);
    if (options.persist) await persistScope(pool, year, key, swings);
    scopes.push({ scope, scopeKey: key, eventCount: scoped.length, swings });
  }

  return { year, totalEventCount: events.length, persisted: options.persist, scopes };
}

export type PersistedSwing = {
  id: string;
  year: number;
  levelScope: string;
  kind: string;
  label: string;
  startWeek: number;
  endWeek: number;
  totalWeeks: number;
  surfaceConsistent: boolean;
  surfaces: string[];
  tierMix: string;
  countries: string[];
  events: Array<{
    editionId: string;
    week: number;
    position: number;
  }>;
};

/**
 * Read persisted swings for a year + level scope (defaults to ATP+Challenger),
 * newest-first by start week. Used by the /swings UI for fast reads without
 * recomputing.
 */
export async function readSwings(
  pool: Pool,
  year: number,
  scope: string = scopeKey(DEFAULT_LEVEL_SCOPE)
): Promise<PersistedSwing[]> {
  const swingsResult = await pool.query(
    `select id, year, level_scope, kind, label, start_week, end_week, total_weeks,
            surface_consistent, surfaces, tier_mix, countries
     from swings
     where year = $1 and level_scope = $2
     order by start_week, end_week`,
    [year, scope]
  );
  if (swingsResult.rows.length === 0) return [];

  const ids = swingsResult.rows.map((row) => row.id as string);
  const eventsResult = await pool.query(
    `select swing_id, tournament_edition_id, week, position
     from swing_events
     where swing_id = any($1::uuid[])
     order by position`,
    [ids]
  );
  const eventsBySwing = new Map<string, PersistedSwing['events']>();
  for (const row of eventsResult.rows) {
    const list = eventsBySwing.get(row.swing_id) ?? [];
    list.push({
      editionId: row.tournament_edition_id,
      week: row.week,
      position: row.position,
    });
    eventsBySwing.set(row.swing_id, list);
  }

  return swingsResult.rows.map((row) => ({
    id: row.id,
    year: row.year,
    levelScope: row.level_scope,
    kind: row.kind,
    label: row.label,
    startWeek: row.start_week,
    endWeek: row.end_week,
    totalWeeks: row.total_weeks,
    surfaceConsistent: row.surface_consistent,
    surfaces: row.surfaces,
    tierMix: row.tier_mix,
    countries: row.countries,
    events: eventsBySwing.get(row.id) ?? [],
  }));
}

/** Compact, readable description of one swing (sanity output + API). */
export function describeSwing(swing: DetectedSwing): {
  kind: string;
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
    kind: swing.kind,
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

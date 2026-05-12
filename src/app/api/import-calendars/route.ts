import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS, type TournamentEdition } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function upsertTournamentAndEdition(item: TournamentEdition) {
  const tournamentResult = await pool.query<{ id: string }>(
    `
    insert into tournaments (slug, name, city, country, updated_at)
    values ($1, $2, $3, $4, now())
    on conflict (slug)
    do update set
      name = excluded.name,
      city = excluded.city,
      country = excluded.country,
      updated_at = now()
    returning id
    `,
    [item.tournament.slug, item.tournament.name, item.tournament.city, item.tournament.country]
  );

  const tournamentId = tournamentResult.rows[0].id;

  await pool.query(
    `
    insert into tournament_editions (
      tournament_id,
      year,
      week,
      start_date,
      end_date,
      level,
      surface,
      indoor,
      source,
      source_url,
      status,
      updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    on conflict (tournament_id, year)
    do update set
      week = excluded.week,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      level = excluded.level,
      surface = excluded.surface,
      indoor = excluded.indoor,
      source = excluded.source,
      source_url = excluded.source_url,
      status = excluded.status,
      updated_at = now()
    `,
    [
      tournamentId,
      item.edition.year,
      item.edition.week,
      item.edition.start_date,
      item.edition.end_date,
      item.edition.level,
      item.edition.surface,
      item.edition.indoor,
      item.edition.source,
      item.edition.source_url,
      item.edition.status,
    ]
  );

  return {
    slug: item.tournament.slug,
    name: item.tournament.name,
    year: item.edition.year,
    week: item.edition.week,
    level: item.edition.level,
  };
}

export async function GET() {
  const imported = [];
  const failed = [];
  const syncedYears = Array.from(new Set(ALL_EDITIONS.map((item) => item.edition.year)));

  for (const item of ALL_EDITIONS) {
    try {
      imported.push(await upsertTournamentAndEdition(item));
    } catch (error) {
      failed.push({
        slug: item.tournament.slug,
        name: item.tournament.name,
        year: item.edition.year,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const staleCleanup = [];

  // Only run destructive stale cleanup against the current canonical 2026 calendar.
  // Historical 2024/2025 rows are backfilled from actual played tournaments, so the
  // static 2026 calendar is not allowed to mark them as not held.
  const staleCleanupYears = syncedYears.filter((year) => year === 2026);
  const staleCleanupSkippedYears = syncedYears.filter((year) => year !== 2026);

  for (const year of staleCleanupYears) {
    const slugsForYear = Array.from(
      new Set(
        ALL_EDITIONS.filter((item) => item.edition.year === year).map((item) => item.tournament.slug)
      )
    );

    const cleanupResult = await pool.query<{
      slug: string;
      year: number;
      status: string;
    }>(
      `
      update tournament_editions te
      set status = 'not_held',
          updated_at = now()
      from tournaments t
      where te.tournament_id = t.id
        and te.year = $1
        and te.status <> 'not_held'
        and not (t.slug = any($2::text[]))
      returning t.slug, te.year, te.status
      `,
      [year, slugsForYear]
    );

    staleCleanup.push({
      year,
      markedNotHeldCount: cleanupResult.rowCount ?? 0,
      markedNotHeld: cleanupResult.rows,
    });
  }

  return NextResponse.json({
    ok: failed.length === 0,
    importedCount: imported.length,
    failedCount: failed.length,
    syncedYears,
    staleCleanupYears,
    staleCleanupSkippedYears,
    staleCleanup,
    imported,
    failed,
  });
}

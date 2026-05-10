import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-syncs all canonical 2026 tournament data from tournament-data.ts into the DB,
// overwriting any JeffSackmann-imported dates/weeks with the correct ATP scheduled values.
// Also marks any DB editions (for 2026) that are NOT in tournament-data.ts as 'not_held'.
// Safe to run any time — fully idempotent.

export async function GET() {
  const synced = [];
  const failed = [];

  for (const item of ALL_EDITIONS) {
    try {
      const tourResult = await pool.query<{ id: string }>(
        `insert into tournaments (slug, name, city, country, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (slug) do update set
           name = excluded.name,
           city = excluded.city,
           country = excluded.country,
           updated_at = now()
         returning id`,
        [item.tournament.slug, item.tournament.name, item.tournament.city, item.tournament.country]
      );
      const tournamentId = tourResult.rows[0].id;

      await pool.query(
        `insert into tournament_editions (
           tournament_id, year, week, start_date, end_date, level, surface, indoor,
           source, source_url, status, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         on conflict (tournament_id, year) do update set
           week = excluded.week,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           level = excluded.level,
           surface = excluded.surface,
           indoor = excluded.indoor,
           source = excluded.source,
           status = excluded.status,
           updated_at = now()`,
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
          item.edition.source_url ?? null,
          item.edition.status,
        ]
      );

      synced.push({ slug: item.tournament.slug, year: item.edition.year, week: item.edition.week });
    } catch (err) {
      failed.push({
        slug: item.tournament.slug,
        year: item.edition.year,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Recompute week for 2024 and 2025 from their stored start_dates
  const weekFixResults = await Promise.all(
    [2024, 2025].map((year) =>
      pool.query<{ count: string }>(
        `update tournament_editions te
         set week = greatest(1, (te.start_date::date - date_trunc('week', make_date(te.year, 1, 7))::date) / 7 + 1),
             updated_at = now()
         where te.year = $1
           and te.start_date is not null
           and not (extract(month from te.start_date) = 12 and extract(year from te.start_date) = te.year)`,
        [year]
      )
    )
  );

  return NextResponse.json({
    ok: failed.length === 0,
    syncedCount: synced.length,
    failedCount: failed.length,
    weeksRecomputedFor2024: weekFixResults[0].rowCount ?? 0,
    weeksRecomputedFor2025: weekFixResults[1].rowCount ?? 0,
    failed,
  });
}

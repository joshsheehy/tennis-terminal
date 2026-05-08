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

  return NextResponse.json({
    ok: failed.length === 0,
    importedCount: imported.length,
    failedCount: failed.length,
    imported,
    failed,
  });
}

import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

const HONG_KONG_SLUG = 'bank-of-china-hong-kong-tennis-open-hong-kong';

const officialRows = [
  {
    year: 2023,
    week: null,
    start_date: null,
    end_date: null,
    level: 'Not Held',
    surface: 'NA',
    indoor: null,
    source: 'atp_tour_official_news',
    source_url: 'https://www.atptour.com/en/news/hong-kong-atp-250-2024',
    status: 'not_held',
  },
  {
    year: 2024,
    week: 1,
    start_date: '2024-01-01',
    end_date: '2024-01-07',
    level: 'ATP 250',
    surface: 'Hard',
    indoor: false,
    source: 'atp_tour_pdf',
    source_url: 'https://www.atptour.com/-/media/files/final-2024-atp-calendar.pdf',
    status: 'held',
  },
  {
    year: 2025,
    week: 1,
    start_date: '2024-12-30',
    end_date: '2025-01-05',
    level: 'ATP 250',
    surface: 'Hard',
    indoor: false,
    source: 'atp_tour_pdf',
    source_url: 'https://www.atptour.com/-/media/files/calendar-pdfs/2024/2025-atp-tour-calendar-25-november-2024.pdf',
    status: 'held',
  },
] as const;

async function ensureNullableStartDate(client: PoolClient) {
  await client.query(`alter table tournament_editions alter column start_date drop not null;`);
}

export async function GET() {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensureNullableStartDate(client);

    const tournamentResult = await client.query<{ id: string }>(
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
      [HONG_KONG_SLUG, 'Bank of China Hong Kong Tennis Open', 'Hong Kong', 'Hong Kong']
    );

    const tournamentId = tournamentResult.rows[0].id;

    for (const row of officialRows) {
      await client.query(
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
          row.year,
          row.week,
          row.start_date,
          row.end_date,
          row.level,
          row.surface,
          row.indoor,
          row.source,
          row.source_url,
          row.status,
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      imported: true,
      tournament: 'Bank of China Hong Kong Tennis Open',
      rowsImported: officialRows.length,
      years: officialRows.map((row) => row.year),
      note: 'Official-source-backed historical editions only. Cut data still requires draw PDF parsing.',
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }

    console.error(error);

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}

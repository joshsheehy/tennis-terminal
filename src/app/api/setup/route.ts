import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';

export async function GET() {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    await client.query(`create extension if not exists pgcrypto;`);

    await client.query(`
      create table if not exists tournaments (
        id uuid primary key default gen_random_uuid(),
        slug text not null unique,
        name text not null,
        city text not null,
        country text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await client.query(`
      create table if not exists tournament_editions (
        id uuid primary key default gen_random_uuid(),
        tournament_id uuid not null references tournaments(id) on delete cascade,
        year int not null,
        week int,
        start_date date not null,
        end_date date,
        level text not null,
        surface text not null,
        indoor boolean,
        source text not null,
        source_url text,
        status text not null default 'held' check (status in ('held', 'not_held')),
        singles_draw_size int,
        qualifying_draw_size int,
        doubles_draw_size int,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tournament_id, year)
      );
    `);

    await client.query(`
      create table if not exists cutoff_snapshots (
        id uuid primary key default gen_random_uuid(),
        tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
        event_type text not null check (event_type in ('singles', 'doubles')),
        draw_type text not null check (draw_type in ('main', 'qualifying')),
        source_type text not null default 'official_pdf',
        last_direct_acceptance_rank int,
        last_direct_acceptance_player_name text,
        last_alternate_rank int,
        last_alternate_player_name text,
        challenger_doubles_advanced_cut_rank int,
        challenger_doubles_advanced_team_name text,
        challenger_doubles_onsite_cut_rank int,
        challenger_doubles_onsite_team_name text,
        parsed_at timestamptz,
        parser_version text,
        source_notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tournament_edition_id, event_type, draw_type)
      );
    `);

    await client.query(`
      create index if not exists tournament_editions_start_date_idx on tournament_editions(start_date);
      create index if not exists tournament_editions_level_idx on tournament_editions(level);
      create index if not exists cutoff_snapshots_tournament_edition_idx on cutoff_snapshots(tournament_edition_id);
    `);

    // Email alert subscribers + per-(subscriber, deadline) send log. Also
    // created lazily by ensureSubscriberTables(); kept here so a fresh /api/setup
    // provisions everything in one pass.
    await client.query(`
      create table if not exists alert_subscribers (
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        active boolean not null default true,
        categories text[] not null default array['atp','challenger'],
        unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
        created_at timestamptz not null default now(),
        unsubscribed_at timestamptz
      );
    `);
    await client.query(
      `alter table alert_subscribers
         add column if not exists categories text[] not null default array['atp','challenger'];`
    );
    await client.query(`
      create table if not exists alert_sends (
        id uuid primary key default gen_random_uuid(),
        subscriber_id uuid not null references alert_subscribers(id) on delete cascade,
        alert_key text not null,
        sent_at timestamptz not null default now(),
        unique (subscriber_id, alert_key)
      );
    `);

    for (const item of ALL_EDITIONS) {
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
        [item.tournament.slug, item.tournament.name, item.tournament.city, item.tournament.country]
      );

      const tournamentId = tournamentResult.rows[0].id;

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
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      tournamentsImported: ALL_EDITIONS.length,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }

    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}

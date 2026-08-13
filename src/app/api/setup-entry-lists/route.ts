import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Idempotent production-safe setup for ATP acceptance-list and movement history
// storage. Official-source ingestion and public-source observation remain
// separate pipelines so neither can overwrite the other's provenance.
export async function GET() {
  await pool.query(`
    create table if not exists acceptance_list_sources (
      id uuid primary key default gen_random_uuid(),
      tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
      event_type text not null check (event_type in ('singles', 'doubles')),
      draw_type text not null check (draw_type in ('main', 'qualifying')),
      atp_code text,
      source_type text not null default 'official_public_pdf',
      source_url text not null,
      active boolean not null default true,
      etag text,
      last_modified text,
      last_content_hash text,
      last_checked_at timestamptz,
      last_changed_at timestamptz,
      next_check_at timestamptz,
      failure_count int not null default 0,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tournament_edition_id, event_type, draw_type, source_url)
    );

    create table if not exists acceptance_list_snapshots (
      id uuid primary key default gen_random_uuid(),
      source_id uuid not null references acceptance_list_sources(id) on delete cascade,
      fetched_at timestamptz not null default now(),
      list_date date,
      ranking_date date,
      original_cutoff_rank int,
      player_list_type text,
      parse_status text not null check (parse_status in ('parsed', 'missing_cutoff', 'not_acceptance_list', 'needs_ocr')),
      entry_count int not null default 0,
      entries jsonb not null default '[]'::jsonb,
      content_hash text not null,
      created_at timestamptz not null default now(),
      unique (source_id, content_hash)
    );

    alter table acceptance_list_snapshots
      add column if not exists player_list_type text;

    create table if not exists entry_list_source_status (
      week_start date not null,
      source_key text not null,
      source_url text not null,
      last_checked_at timestamptz,
      last_changed_at timestamptz,
      last_content_hash text,
      last_error text,
      updated_at timestamptz not null default now(),
      primary key (week_start, source_key)
    );

    create table if not exists entry_list_source_snapshots (
      id uuid primary key default gen_random_uuid(),
      week_start date not null,
      source_key text not null,
      source_url text not null,
      fetched_at timestamptz not null default now(),
      content_hash text not null,
      raw_payload text not null,
      parsed_payload jsonb not null default '[]'::jsonb,
      source_updated_text text,
      created_at timestamptz not null default now(),
      unique (week_start, source_key, content_hash)
    );

    create table if not exists entry_list_movements (
      id uuid primary key default gen_random_uuid(),
      week_start date not null,
      tournament_slug text not null,
      event_type text not null default 'singles' check (event_type in ('singles', 'doubles')),
      player_name text not null,
      movement_type text not null check (movement_type in (
        'md_withdrawal', 'md_alt_to_md', 'q_to_md', 'q_withdrawal',
        'q_alt_to_q', 'q_alt_to_md', 'q_alt_withdrawal',
        'removed_unknown', 'reported_next'
      )),
      from_section text not null check (from_section in ('main', 'main_alt', 'qualifying', 'qualifying_alt', 'unknown')),
      to_section text not null check (to_section in ('main', 'qualifying', 'out', 'unknown')),
      entry_rank int,
      original_position int,
      q_spots_delta int not null default 0,
      observed_at timestamptz not null default now(),
      source_key text not null,
      source_url text,
      raw_text text,
      evidence jsonb not null default '{}'::jsonb,
      fingerprint text not null unique,
      created_at timestamptz not null default now()
    );

    -- How each draw was filled, one row per entry route. A row per route rather
    -- than a column per route: the accelerator programmes change between
    -- seasons, and a new code should be a new row, not a migration.
    create table if not exists entry_list_draw_composition (
      week_start date not null,
      tournament_slug text not null,
      draw text not null check (draw in ('main', 'main_alt', 'qualifying')),
      entry_route text not null,
      live_count int not null default 0,
      departed_count int not null default 0,
      source_key text not null,
      observed_at timestamptz not null default now(),
      primary key (week_start, tournament_slug, draw, entry_route)
    );

    -- The ATP tournament detail sheet's draws table: the authoritative, public
    -- statement of how each draw is built. Keyed by ATP tournament code and
    -- draw, since a code identifies the event across sources.
    create table if not exists tournament_detail_sheets (
      week_start date not null,
      atp_code text not null,
      draw text not null check (draw in ('qualifying', 'main_singles', 'main_doubles')),
      draw_size int,
      direct_acceptances int,
      wild_cards int,
      qualifiers int,
      special_exempts int,
      special_exempts_held int,
      next_gen int,
      next_gen_held int,
      prior_cutoff int,
      raw_cells text,
      source_url text not null,
      adds_up boolean not null default false,
      fetched_at timestamptz not null default now(),
      primary key (week_start, atp_code, draw)
    );

    -- Added after the table shipped: the held half of the SE and NG cells.
    alter table tournament_detail_sheets add column if not exists special_exempts_held int;
    alter table tournament_detail_sheets add column if not exists next_gen_held int;

    create index if not exists acceptance_list_sources_due_idx
      on acceptance_list_sources(active, next_check_at)
      where active = true;

    create index if not exists acceptance_list_sources_edition_idx
      on acceptance_list_sources(tournament_edition_id);

    create index if not exists acceptance_list_snapshots_source_fetched_idx
      on acceptance_list_snapshots(source_id, fetched_at desc);

    create index if not exists entry_list_source_snapshots_week_idx
      on entry_list_source_snapshots(week_start, source_key, fetched_at desc);

    create index if not exists entry_list_movements_week_event_idx
      on entry_list_movements(week_start, tournament_slug, observed_at desc);

    create index if not exists entry_list_draw_composition_week_idx
      on entry_list_draw_composition(week_start, tournament_slug);
  `);

  // Preserve old proof snapshots, but make sure legacy experimental acceptance
  // sources cannot be polled by the official PDF scheduler. The new public
  // history poller uses its own tables and is intentionally unaffected here.
  const deactivated = await pool.query<{ id: string }>(
    `
    update acceptance_list_sources
    set active = false, next_check_at = null, updated_at = now()
    where source_type in (
      'official_tournament_pdf',
      'official_federation_pdf',
      'central_public_aggregator_experiment'
    )
      and active = true
    returning id
    `
  );

  return NextResponse.json({ ok: true, deactivatedLegacyAcceptanceSources: deactivated.rowCount ?? 0 });
}

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Idempotent production-safe setup for lightweight ATP acceptance-list storage.
// Source discovery/selection lives outside this route. The production design is
// intentionally official-source only; regional/third-party experiments are not
// created or activated here.
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

    create index if not exists acceptance_list_sources_due_idx
      on acceptance_list_sources(active, next_check_at)
      where active = true;

    create index if not exists acceptance_list_sources_edition_idx
      on acceptance_list_sources(tournament_edition_id);

    create index if not exists acceptance_list_snapshots_source_fetched_idx
      on acceptance_list_snapshots(source_id, fetched_at desc);
  `);

  // Preserve old proof snapshots, but make sure no organizer/federation or
  // third-party proof source can be polled by a future generic scheduler.
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

  return NextResponse.json({ ok: true, deactivatedNonCentralOfficialSources: deactivated.rowCount ?? 0 });
}

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Idempotent production-safe setup for the lightweight entry-list tables.
// Source discovery/selection lives outside this route. We intentionally do not
// seed tournament- or federation-specific websites here: the experiment is now
// focused on centralized sources that can cover an entire ATP week.
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
      parse_status text not null check (parse_status in ('parsed', 'missing_cutoff', 'not_acceptance_list', 'needs_ocr')),
      entry_count int not null default 0,
      entries jsonb not null default '[]'::jsonb,
      content_hash text not null,
      created_at timestamptz not null default now(),
      unique (source_id, content_hash)
    );

    create index if not exists acceptance_list_sources_due_idx
      on acceptance_list_sources(active, next_check_at)
      where active = true;

    create index if not exists acceptance_list_sources_edition_idx
      on acceptance_list_sources(tournament_edition_id);

    create index if not exists acceptance_list_snapshots_source_fetched_idx
      on acceptance_list_snapshots(source_id, fetched_at desc);
  `);

  // Earlier proof-of-concept rows pointed directly at organizer sites. Preserve
  // their snapshots for comparison, but stop polling those sources going forward.
  const deactivated = await pool.query<{ id: string }>(
    `
    update acceptance_list_sources
    set active = false, next_check_at = null, updated_at = now()
    where source_type in ('official_tournament_pdf', 'official_federation_pdf')
      and active = true
    returning id
    `
  );

  return NextResponse.json({ ok: true, deactivatedRegionalSources: deactivated.rowCount ?? 0 });
}

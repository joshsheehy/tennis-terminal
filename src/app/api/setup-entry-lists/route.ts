import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SeedSource = {
  city: string;
  year: number;
  eventType: 'singles' | 'doubles';
  drawType: 'main' | 'qualifying';
  atpCode: string;
  sourceUrl: string;
};

// Only sources we have verified are genuinely public and organizer/federation hosted
// belong here. Do not add PlayerZone URLs or guessed URLs.
const VERIFIED_PUBLIC_SOURCES: SeedSource[] = [
  {
    city: 'Todi',
    year: 2026,
    eventType: 'singles',
    drawType: 'main',
    atpCode: '8392',
    sourceUrl: 'https://internazionalitodi.com/wp-content/uploads/sites/8/2026/07/Todi-MDS.pdf',
  },
  {
    city: 'Todi',
    year: 2026,
    eventType: 'doubles',
    drawType: 'main',
    atpCode: '8392',
    sourceUrl: 'https://internazionalitodi.com/wp-content/uploads/sites/8/2026/08/Todi-MDD.pdf',
  },
];

// Idempotent production-safe setup for the lightweight entry-list tables.
// Keeping this as a protected admin endpoint lets GitHub Actions initialize a
// fresh Railway database without needing the DATABASE_URL secret in GitHub.
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

  const seeded: Array<Record<string, unknown>> = [];
  for (const source of VERIFIED_PUBLIC_SOURCES) {
    const edition = await pool.query<{ id: string; name: string }>(
      `
      select te.id, t.name
      from tournament_editions te
      join tournaments t on t.id = te.tournament_id
      where te.year = $1
        and lower(t.city) = lower($2)
        and te.status = 'held'
        and te.level not ilike 'ITF%'
      order by te.updated_at desc
      limit 1
      `,
      [source.year, source.city]
    );

    if (!edition.rows[0]) {
      seeded.push({ city: source.city, year: source.year, status: 'edition_not_found' });
      continue;
    }

    const result = await pool.query<{ id: string }>(
      `
      insert into acceptance_list_sources (
        tournament_edition_id, event_type, draw_type, atp_code,
        source_type, source_url, active, next_check_at, updated_at
      ) values ($1, $2, $3, $4, 'official_tournament_pdf', $5, true, now(), now())
      on conflict (tournament_edition_id, event_type, draw_type, source_url)
      do update set
        atp_code = excluded.atp_code,
        source_type = excluded.source_type,
        active = true,
        next_check_at = least(acceptance_list_sources.next_check_at, now()),
        updated_at = now()
      returning id
      `,
      [edition.rows[0].id, source.eventType, source.drawType, source.atpCode, source.sourceUrl]
    );

    seeded.push({
      tournament: edition.rows[0].name,
      eventType: source.eventType,
      drawType: source.drawType,
      sourceId: result.rows[0]?.id,
      status: 'seeded',
    });
  }

  return NextResponse.json({ ok: true, seeded });
}

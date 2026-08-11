-- One compact JSON snapshot per ATP week whenever the centralized source changes.
-- This is intentionally week-level rather than player-row-level: a single fetch and
-- a single small JSON document can power all tournament/player comparisons later.
create table if not exists central_entry_list_week_snapshots (
  id uuid primary key default gen_random_uuid(),
  tour text not null default 'atp',
  week_start date not null,
  source_type text not null,
  source_url text not null,
  source_updated_text text,
  content_hash text not null,
  tournament_count int not null default 0,
  tournaments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tour, week_start, content_hash)
);

create index if not exists central_entry_list_week_latest_idx
  on central_entry_list_week_snapshots(tour, week_start, created_at desc);

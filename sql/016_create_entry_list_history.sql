-- Immutable raw/public source snapshots plus a deduplicated movement ledger.
-- This supplements acceptance_list_snapshots: the latter stores parsed official
-- acceptance documents; these tables preserve changing public list states and
-- explicit OUT / IN evidence without overwriting history.

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
    'md_withdrawal',
    'md_alt_to_md',
    'q_to_md',
    'q_withdrawal',
    'q_alt_to_q',
    'q_alt_to_md',
    'q_alt_withdrawal',
    'removed_unknown',
    'reported_next'
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

create index if not exists entry_list_source_snapshots_week_idx
  on entry_list_source_snapshots(week_start, source_key, fetched_at desc);

create index if not exists entry_list_movements_week_event_idx
  on entry_list_movements(week_start, tournament_slug, observed_at desc);

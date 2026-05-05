create extension if not exists pgcrypto;

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  city text not null,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  alternate_entries_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_edition_id, event_type, draw_type)
);

create index if not exists tournament_editions_start_date_idx on tournament_editions(start_date);
create index if not exists tournament_editions_level_idx on tournament_editions(level);
create index if not exists cutoff_snapshots_tournament_edition_idx on cutoff_snapshots(tournament_edition_id);

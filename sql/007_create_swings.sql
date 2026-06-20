-- Swings phase 2: persisted swing detection results. Additive only — two new
-- tables, no changes to anything existing. Recomputes are delete + reinsert
-- per year inside a transaction, so existing tables are never touched.
create table if not exists swings (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  label text not null,
  start_week int not null,
  end_week int not null,
  total_weeks int not null,
  surface_consistent boolean not null,
  surfaces text[] not null,
  tier_mix text not null,
  countries text[] not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists swing_events (
  id uuid primary key default gen_random_uuid(),
  swing_id uuid not null references swings(id) on delete cascade,
  tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
  week int not null,
  position int not null,
  created_at timestamptz not null default now(),
  unique (swing_id, tournament_edition_id)
);

create index if not exists swings_year_idx on swings(year);
create index if not exists swing_events_swing_idx on swing_events(swing_id);
create index if not exists swing_events_edition_idx on swing_events(tournament_edition_id);

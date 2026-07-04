-- Beta cut projections. One row per (edition, draw, horizon): the nightly
-- prediction job writes a fresh row as an event moves inside each horizon
-- bucket (4, 3, 2, 1 weeks out), so accuracy per lead time is trackable.
-- actual_cut/scored_at are backfilled by the scoring pass once the real cut
-- is imported.
create table if not exists cut_predictions (
  id uuid primary key default gen_random_uuid(),
  tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
  event_type text not null check (event_type in ('singles', 'doubles')),
  draw_type text not null check (draw_type in ('main', 'qualifying')),
  horizon_weeks int not null,
  predicted_cut int not null,
  predicted_low int not null,
  predicted_high int not null,
  method text not null,
  model_version text not null,
  predicted_at timestamptz not null default now(),
  actual_cut int,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_edition_id, event_type, draw_type, horizon_weeks)
);

create index if not exists cut_predictions_edition_idx on cut_predictions(tournament_edition_id);
create index if not exists cut_predictions_unscored_idx on cut_predictions(scored_at) where scored_at is null;

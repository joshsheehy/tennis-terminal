-- Everything on each ProTennisLive detail sheet the conditions sync reads: the
-- full row text plus every labelled field, the contact list (role -> name,
-- phone, email), phones, emails and links. One row per distinct version of a
-- sheet (a re-read that changed nothing adds nothing). An archive for later
-- use; nothing on the site reads it yet. Created lazily by
-- src/lib/edition-conditions.ts.
create table if not exists detail_sheet_snapshots (
  id bigserial primary key,
  edition_id uuid not null references tournament_editions(id) on delete cascade,
  sheet_url text,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  row_text text not null,
  fields jsonb not null default '{}'::jsonb,
  contacts jsonb not null default '[]'::jsonb,
  phones text[] not null default '{}',
  emails text[] not null default '{}',
  links text[] not null default '{}'
);
create index if not exists detail_sheet_snapshots_edition_idx
  on detail_sheet_snapshots (edition_id, fetched_at desc);

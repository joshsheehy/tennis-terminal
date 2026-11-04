-- ATP/Challenger editions already announced on Telegram as new tournaments
-- (/api/announce-new-tournaments). baseline = recorded on the first run
-- without a message. Created lazily by src/lib/tournament-announcements.ts.
create table if not exists tournament_announcements (
  edition_id uuid primary key references tournament_editions(id) on delete cascade,
  announced_at timestamptz not null default now(),
  baseline boolean not null default false
);

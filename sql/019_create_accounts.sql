-- Accounts for saving tournaments to a personal schedule. Email-code login
-- (no passwords); sessions are random tokens of which only the sha256 is kept.
--
-- These are also created lazily at runtime by ensureAccountTables()
-- (src/lib/accounts.ts), so applying this file by hand is optional — it's
-- here as the canonical schema of record.
--
-- saved_tournaments cascades with its edition. The dedupe/merge tools move
-- saves onto the surviving edition first (src/lib/saved-tournaments-repoint.ts),
-- so only a genuine delete-edition drops them.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  request_ip text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists login_codes_email_created_idx on login_codes (email, created_at desc);
create index if not exists login_codes_ip_created_idx on login_codes (request_ip, created_at desc);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists saved_tournaments (
  user_id uuid not null references users(id) on delete cascade,
  edition_id uuid not null references tournament_editions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, edition_id)
);

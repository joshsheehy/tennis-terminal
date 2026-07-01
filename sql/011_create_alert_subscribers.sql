-- Email alert subscribers + a per-(subscriber, deadline) send log so the daily
-- deadline-alert cron is idempotent and never double-emails.
--
-- These are also created lazily at runtime by ensureSubscriberTables()
-- (src/lib/subscribers.ts) and by /api/setup, so applying this file by hand is
-- optional — it's here as the canonical schema of record.

create extension if not exists pgcrypto;

create table if not exists alert_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  active boolean not null default true,
  -- Subset of 'atp','challenger','itf','grandslam'.
  categories text[] not null default array['atp','challenger'],
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- Additive migration for databases where the table predates the column.
alter table alert_subscribers
  add column if not exists categories text[] not null default array['atp','challenger'];

create table if not exists alert_sends (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references alert_subscribers(id) on delete cascade,
  alert_key text not null,
  sent_at timestamptz not null default now(),
  unique (subscriber_id, alert_key)
);

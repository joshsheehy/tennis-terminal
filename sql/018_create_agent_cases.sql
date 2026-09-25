-- The audit bot's case ledger: one row per problem it has found, so a second agent (the "boss") can work
-- them and you can ask the Telegram bot what is open, fixed, or waiting on you.
--
-- Kept in the database, not the repo: it changes every cycle (a committed file would redeploy the site each
-- time) and several writers touch it at once. It is only reachable through the admin API. The app also
-- creates these tables on first use (ensureAgentTables in src/lib/agent-cases.ts), so deploying the code
-- before applying this file cannot break anything.
create table if not exists agent_cases (
  id bigserial primary key,
  -- Stable identity of the problem, e.g. "A2|plovdiv-4@2026". The audit emits the same key every run.
  key text not null unique,
  check_id text not null,
  severity text not null check (severity in ('critical', 'warn')),
  title text not null,
  detail text not null default '',
  -- Structured facts the boss needs to act (slug, year, draw, sheet url ...).
  data jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'fixed', 'escalated', 'acknowledged')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  times_seen int not null default 1,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  escalated_at timestamptz,
  -- When the user was told, so an escalation is sent once.
  notified_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_cases_status_idx on agent_cases(status);
create index if not exists agent_cases_check_idx on agent_cases(check_id);

create table if not exists agent_case_events (
  id bigserial primary key,
  case_id bigint not null references agent_cases(id) on delete cascade,
  at timestamptz not null default now(),
  -- audit | boss | you | system
  actor text not null,
  action text not null,
  note text not null default ''
);

create index if not exists agent_case_events_case_idx on agent_case_events(case_id, at desc);

-- Tiny durable key/value store for whatever small bit of cross-run state a script needs next; a GitHub
-- Actions cron run has no memory of its own, so anything like that has to live somewhere, and the same
-- database the ledger already lives in is simpler than a second store. Not currently used by anything —
-- the Telegram poller (scripts/telegram-bot.mjs) used to keep its update offset here before it was
-- replaced by a webhook (src/app/api/telegram-webhook/route.ts), which has no offset to track.
create table if not exists agent_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

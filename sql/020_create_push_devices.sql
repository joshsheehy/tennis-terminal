-- iOS devices that receive entry-deadline pushes. One row per APNs token,
-- owned by an account; push on/off for a phone is whether its row exists.
-- What gets pushed follows the account's alert_subscribers preferences (same
-- tours, doubles and reminder windows as the email) — alert_subscribers.active
-- is the email switch only and never gates push. Dedupe reuses alert_sends with
-- "push:"-prefixed keys.
--
-- Also created lazily at runtime by ensurePushTables()
-- (src/lib/push-devices.ts), so applying this file by hand is optional.

create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  -- The APNs environment that last accepted this token: Xcode builds are
  -- sandbox, TestFlight / App Store builds production.
  env text not null default 'production' check (env in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on push_devices (user_id);

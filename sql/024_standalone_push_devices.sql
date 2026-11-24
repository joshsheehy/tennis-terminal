-- Push without an account. A push_devices row with no user_id is a phone that
-- turned push on while signed out: it follows its own preferences below
-- instead of an account's alert_subscribers row, and dedupes in
-- push_device_sends instead of alert_sends. Signing in moves the row to the
-- account; signing out moves it back, copying the account's preferences.
--
-- Also applied lazily at runtime by ensurePushTables()
-- (src/lib/push-devices.ts), so applying this file by hand is optional.

alter table push_devices alter column user_id drop not null;
alter table push_devices add column if not exists categories text[] not null default array['grandslam','atp','challenger'];
alter table push_devices add column if not exists include_doubles boolean not null default false;
alter table push_devices add column if not exists reminder_hours integer[] not null default array[24];

create table if not exists push_device_sends (
  device_id uuid not null references push_devices(id) on delete cascade,
  alert_key text not null,
  sent_at timestamptz not null default now(),
  primary key (device_id, alert_key)
);

import { pool } from './db';
import { ensureAccountTables } from './accounts';
import type { Category } from './entry-deadlines';
import { ensureSubscriberTables, type Subscriber } from './subscribers';
import type { ApnsEnv } from './apns';

// iOS devices that receive deadline pushes, one row per APNs token. Push
// on/off for a phone is simply whether its row exists. A device either
// belongs to an account (user_id set: what gets pushed follows the account's
// alert_subscribers preferences, same tours, doubles and reminder windows as
// the email; `active` on that row is the *email* switch only and never gates
// push) or stands alone (user_id null: push without signing in, following the
// device's own categories / include_doubles / reminder_hours). The APNs token
// is the phone's proof for its own row: only that app install ever has it.
// Created lazily like the other tables; sql/020_create_push_devices.sql and
// sql/024_standalone_push_devices.sql are the schema of record.

let ensured: Promise<void> | null = null;

export function ensurePushTables(): Promise<void> {
  ensured ??= (async () => {
    await ensureAccountTables();
    await pool.query(`
      create table if not exists push_devices (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references users(id) on delete cascade,
        token text not null unique,
        env text not null default 'production' check (env in ('production', 'sandbox')),
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );
    `);
    await pool.query(`create index if not exists push_devices_user_idx on push_devices (user_id);`);
    // Additive migrations for push without an account (sql/024).
    await pool.query(`alter table push_devices alter column user_id drop not null;`);
    await pool.query(
      `alter table push_devices
         add column if not exists categories text[] not null default array['grandslam','atp','challenger'];`
    );
    await pool.query(`alter table push_devices add column if not exists include_doubles boolean not null default false;`);
    await pool.query(`alter table push_devices add column if not exists reminder_hours integer[] not null default array[24];`);
    // Standalone devices have no alert_subscribers row, so they dedupe here
    // instead of in alert_sends.
    await pool.query(`
      create table if not exists push_device_sends (
        device_id uuid not null references push_devices(id) on delete cascade,
        alert_key text not null,
        sent_at timestamptz not null default now(),
        primary key (device_id, alert_key)
      );
    `);
  })().catch((error) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

// APNs tokens are 64+ hex characters.
export function isApnsToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64,200}$/i.test(value);
}

export type DevicePrefs = { categories: Category[]; includeDoubles: boolean; reminderHours: number[] };

type DevicePrefsRow = { categories: Category[]; include_doubles: boolean; reminder_hours: number[] };

const toPrefs = (row: DevicePrefsRow): DevicePrefs => ({
  categories: row.categories,
  includeDoubles: row.include_doubles,
  reminderHours: row.reminder_hours,
});

// The phone's own preferences, and whether it currently belongs to an account.
export async function getDevice(token: string): Promise<{ userId: string | null; prefs: DevicePrefs } | null> {
  await ensurePushTables();
  const result = await pool.query<DevicePrefsRow & { user_id: string | null }>(
    `select user_id, categories, include_doubles, reminder_hours from push_devices where token = $1`,
    [token.toLowerCase()]
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, prefs: toPrefs(row) } : null;
}

// iOS issued the phone a new token (restore, reinstall over a backup): move
// its row, with its account or own preferences and send log, to the new one.
// If the new token is already registered, the old row is just dropped.
export async function replaceDeviceToken(previous: string, token: string): Promise<void> {
  await ensurePushTables();
  const [from, to] = [previous.toLowerCase(), token.toLowerCase()];
  const moved = await pool.query(
    `update push_devices set token = $2, last_seen_at = now()
      where token = $1 and not exists (select 1 from push_devices where token = $2)`,
    [from, to]
  );
  if (!moved.rowCount) await pool.query(`delete from push_devices where token = $1`, [from]);
}

// Upsert by token: a phone that signs into a different account moves to it.
export async function registerDevice(userId: string, token: string): Promise<void> {
  await ensurePushTables();
  await pool.query(
    `insert into push_devices (user_id, token) values ($1, $2)
     on conflict (token) do update set user_id = excluded.user_id, last_seen_at = now()`,
    [userId, token.toLowerCase()]
  );
}

// Push without an account. A new phone starts on the column defaults (Grand
// Slam, ATP, Challenger, 24 hours before). A phone that belonged to an account
// (it signed out, or its session ran out) leaves it and keeps getting what the
// account was getting: SET expressions read the old row, so the subqueries
// still see the previous user_id.
export async function registerStandaloneDevice(token: string): Promise<DevicePrefs> {
  await Promise.all([ensurePushTables(), ensureSubscriberTables()]);
  const fromAccount = (column: string) =>
    `(select s.${column} from users u join alert_subscribers s on s.email = u.email where u.id = push_devices.user_id)`;
  const result = await pool.query<DevicePrefsRow>(
    `insert into push_devices (token) values ($1)
     on conflict (token) do update
       set categories = coalesce(${fromAccount('categories')}, push_devices.categories),
           include_doubles = coalesce(${fromAccount('include_doubles')}, push_devices.include_doubles),
           reminder_hours = coalesce(${fromAccount('reminder_hours')}, push_devices.reminder_hours),
           user_id = null,
           last_seen_at = now()
     returning categories, include_doubles, reminder_hours`,
    [token.toLowerCase()]
  );
  return toPrefs(result.rows[0]);
}

// Only a standalone phone's own preferences; false when the phone has no row
// or belongs to an account (whose preferences live on alert_subscribers).
export async function saveStandaloneDevicePrefs(token: string, prefs: DevicePrefs): Promise<boolean> {
  await ensurePushTables();
  const result = await pool.query(
    `update push_devices
        set categories = $2, include_doubles = $3, reminder_hours = $4, last_seen_at = now()
      where token = $1 and user_id is null`,
    [token.toLowerCase(), prefs.categories, prefs.includeDoubles, prefs.reminderHours]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function unregisterDevice(userId: string, token: string): Promise<void> {
  await ensurePushTables();
  await pool.query(`delete from push_devices where user_id = $1 and token = $2`, [userId, token.toLowerCase()]);
}

export type PushDevice = { token: string; env: ApnsEnv };

export async function listUserDevices(userId: string): Promise<PushDevice[]> {
  await ensurePushTables();
  const result = await pool.query<PushDevice>(`select token, env from push_devices where user_id = $1`, [userId]);
  return result.rows;
}

export async function findDevice(token: string): Promise<PushDevice | null> {
  await ensurePushTables();
  const result = await pool.query<PushDevice>(`select token, env from push_devices where token = $1`, [token.toLowerCase()]);
  return result.rows[0] ?? null;
}

export async function rememberDeviceEnv(token: string, env: ApnsEnv): Promise<void> {
  await pool.query(`update push_devices set env = $2, last_seen_at = now() where token = $1 and env <> $2`, [token, env]);
}

export async function deleteDeviceToken(token: string): Promise<void> {
  await ensurePushTables();
  await pool.query(`delete from push_devices where token = $1`, [token.toLowerCase()]);
}

export type PushTarget = Pick<Subscriber, 'id' | 'email' | 'categories' | 'include_doubles' | 'reminder_hours'> & {
  devices: PushDevice[];
};

// Accounts that should get deadline pushes: those with at least one device,
// joined to their alert preferences by email (whether or not email is on).
export async function listPushTargets(): Promise<PushTarget[]> {
  await Promise.all([ensurePushTables(), ensureSubscriberTables()]);
  const result = await pool.query<PushTarget>(
    `select s.id, s.email, s.categories, s.include_doubles, s.reminder_hours,
            json_agg(json_build_object('token', d.token, 'env', d.env)) as devices
       from alert_subscribers s
       join users u on u.email = s.email
       join push_devices d on d.user_id = u.id
      group by s.id
      order by s.created_at asc`
  );
  return result.rows;
}

export type StandalonePushTarget = DevicePrefsRow & PushDevice & { id: string };

// Phones that get deadline pushes without an account.
export async function listStandalonePushTargets(): Promise<StandalonePushTarget[]> {
  await ensurePushTables();
  const result = await pool.query<StandalonePushTarget>(
    `select id, token, env, categories, include_doubles, reminder_hours
       from push_devices where user_id is null order by created_at asc`
  );
  return result.rows;
}

// Same claim / release contract as claimSend / releaseSend in subscribers.ts.
export async function claimDeviceSend(deviceId: string, alertKey: string): Promise<boolean> {
  const result = await pool.query(
    `insert into push_device_sends (device_id, alert_key) values ($1, $2)
     on conflict (device_id, alert_key) do nothing returning device_id`,
    [deviceId, alertKey]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function releaseDeviceSend(deviceId: string, alertKey: string): Promise<void> {
  await pool.query(`delete from push_device_sends where device_id = $1 and alert_key = $2`, [deviceId, alertKey]);
}

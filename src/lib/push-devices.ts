import { pool } from './db';
import { ensureAccountTables } from './accounts';
import { ensureSubscriberTables, type Subscriber } from './subscribers';
import type { ApnsEnv } from './apns';

// iOS devices that receive deadline pushes, one row per APNs token, owned by
// an account. Push on/off is simply whether the account has a device row;
// what gets pushed follows the account's alert_subscribers preferences (same
// tours, doubles and reminder windows as the email). `active` on that row is
// the *email* switch only — it never gates push. Created lazily like the
// other tables; sql/020_create_push_devices.sql is the schema of record.

let ensured: Promise<void> | null = null;

export function ensurePushTables(): Promise<void> {
  ensured ??= (async () => {
    await ensureAccountTables();
    await pool.query(`
      create table if not exists push_devices (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token text not null unique,
        env text not null default 'production' check (env in ('production', 'sandbox')),
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );
    `);
    await pool.query(`create index if not exists push_devices_user_idx on push_devices (user_id);`);
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

// Upsert by token: a phone that signs into a different account moves to it.
export async function registerDevice(userId: string, token: string): Promise<void> {
  await ensurePushTables();
  await pool.query(
    `insert into push_devices (user_id, token) values ($1, $2)
     on conflict (token) do update set user_id = excluded.user_id, last_seen_at = now()`,
    [userId, token.toLowerCase()]
  );
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

export async function rememberDeviceEnv(token: string, env: ApnsEnv): Promise<void> {
  await pool.query(`update push_devices set env = $2, last_seen_at = now() where token = $1 and env <> $2`, [token, env]);
}

export async function deleteDeviceToken(token: string): Promise<void> {
  await pool.query(`delete from push_devices where token = $1`, [token]);
}

export type PushTarget = Pick<Subscriber, 'id' | 'email' | 'categories' | 'include_doubles' | 'reminder_hours'> & {
  devices: PushDevice[];
};

// Everyone who should get deadline pushes: accounts with at least one device,
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

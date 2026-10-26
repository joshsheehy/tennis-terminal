import { pool, withTransaction } from './db';
import {
  CODES_PER_EMAIL_PER_HOUR,
  CODES_PER_IP_PER_HOUR,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MINUTES,
  SESSION_TTL_DAYS,
  generateLoginCode,
  generateSessionToken,
  hashLoginCode,
  hashesMatch,
  sha256Hex,
} from './auth-core';

// Accounts for saving tournaments to a personal schedule. Login is a 6-digit
// code emailed to the user — no passwords stored anywhere. Sessions are opaque
// random tokens (only their hash is stored) carried in an HttpOnly cookie on
// the web and as a Bearer header from the native app.
//
// Tables are created lazily, the same as alert_subscribers, so a deploy needs
// no separate migration step. sql/019_create_accounts.sql is the schema of
// record.

let ensured: Promise<void> | null = null;

export function ensureAccountTables(): Promise<void> {
  ensured ??= (async () => {
    await pool.query(`create extension if not exists pgcrypto;`);
    await pool.query(`
      create table if not exists users (
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        created_at timestamptz not null default now(),
        last_login_at timestamptz
      );
    `);
    await pool.query(`
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
    `);
    await pool.query(`create index if not exists login_codes_email_created_idx on login_codes (email, created_at desc);`);
    await pool.query(`create index if not exists login_codes_ip_created_idx on login_codes (request_ip, created_at desc);`);
    await pool.query(`
      create table if not exists user_sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
    `);
    await pool.query(`
      create table if not exists saved_tournaments (
        user_id uuid not null references users(id) on delete cascade,
        edition_id uuid not null references tournament_editions(id) on delete cascade,
        created_at timestamptz not null default now(),
        primary key (user_id, edition_id)
      );
    `);
  })().catch((error) => {
    ensured = null; // retry on the next call rather than caching a failure
    throw error;
  });
  return ensured;
}

export type User = { id: string; email: string };

export type CodeRequestResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'rate_limited' };

// Issue a fresh code for `email`, invalidating any earlier unused ones. The
// caller emails the returned code; it is never stored in the clear.
export async function issueLoginCode(email: string, ip: string | null): Promise<CodeRequestResult> {
  await ensureAccountTables();
  const counts = await pool.query<{ by_email: string; by_ip: string }>(
    `select
       (select count(*) from login_codes where email = $1 and created_at > now() - interval '1 hour') as by_email,
       (select count(*) from login_codes where $2::text is not null and request_ip = $2 and created_at > now() - interval '1 hour') as by_ip`,
    [email, ip]
  );
  const row = counts.rows[0];
  if (Number(row.by_email) >= CODES_PER_EMAIL_PER_HOUR || Number(row.by_ip) >= CODES_PER_IP_PER_HOUR) {
    return { ok: false, reason: 'rate_limited' };
  }

  const code = generateLoginCode();
  await withTransaction(async (client) => {
    // Codes (and the IP they were requested from) are only needed for the
    // one-hour rate-limit window, so prune anything older than a day.
    await client.query(`delete from login_codes where created_at < now() - interval '1 day'`);
    await client.query(
      `update login_codes set consumed_at = now() where email = $1 and consumed_at is null`,
      [email]
    );
    await client.query(
      `insert into login_codes (email, code_hash, request_ip, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [email, hashLoginCode(email, code), ip, LOGIN_CODE_TTL_MINUTES]
    );
  });
  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true; user: User; token: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' };

// Check a code against the newest live code for this email. A wrong guess
// burns an attempt; after LOGIN_CODE_MAX_ATTEMPTS the code is dead and a new
// one must be requested. On success the user row is created if needed and a
// session is opened.
export async function verifyLoginCode(email: string, code: string): Promise<VerifyResult> {
  await ensureAccountTables();
  return withTransaction(async (client) => {
    const found = await client.query<{ id: string; code_hash: string; attempts: number; expired: boolean }>(
      `select id, code_hash, attempts, expires_at <= now() as expired
         from login_codes
        where email = $1 and consumed_at is null
        order by created_at desc
        limit 1
        for update`,
      [email]
    );
    const row = found.rows[0];
    if (!row) return { ok: false, reason: 'invalid' } as const;
    if (row.expired) return { ok: false, reason: 'expired' } as const;
    if (row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' } as const;

    if (!hashesMatch(row.code_hash, hashLoginCode(email, code))) {
      const attempts = row.attempts + 1;
      await client.query(`update login_codes set attempts = $2 where id = $1`, [row.id, attempts]);
      return { ok: false, reason: attempts >= LOGIN_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid' } as const;
    }

    await client.query(`update login_codes set consumed_at = now() where id = $1`, [row.id]);
    const user = await client.query<User>(
      `insert into users (email, last_login_at) values ($1, now())
       on conflict (email) do update set last_login_at = now()
       returning id, email`,
      [email]
    );
    const token = generateSessionToken();
    await client.query(
      `insert into user_sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + make_interval(days => $3))`,
      [user.rows[0].id, sha256Hex(token), SESSION_TTL_DAYS]
    );
    return { ok: true, user: user.rows[0], token } as const;
  });
}

export async function getUserBySessionToken(token: string | null): Promise<User | null> {
  if (!token) return null;
  await ensureAccountTables();
  const result = await pool.query<User>(
    `update user_sessions s set last_seen_at = now()
       from users u
      where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id
      returning u.id, u.email`,
    [sha256Hex(token)]
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token: string | null): Promise<void> {
  if (!token) return;
  await ensureAccountTables();
  await pool.query(`delete from user_sessions where token_hash = $1`, [sha256Hex(token)]);
}

// Removes the account and everything hanging off it (sessions, saved
// tournaments cascade). Pending login codes for the address go too. The
// separate email-alert subscription is left alone — it has its own
// unsubscribe link and was signed up for independently.
export async function deleteUser(userId: string): Promise<void> {
  await ensureAccountTables();
  await withTransaction(async (client) => {
    const deleted = await client.query<{ email: string }>(`delete from users where id = $1 returning email`, [userId]);
    const email = deleted.rows[0]?.email;
    if (email) await client.query(`delete from login_codes where email = $1`, [email]);
  });
}

export async function listSavedEditionIds(userId: string): Promise<string[]> {
  await ensureAccountTables();
  const result = await pool.query<{ edition_id: string }>(
    `select edition_id from saved_tournaments where user_id = $1 order by created_at asc`,
    [userId]
  );
  return result.rows.map((r) => r.edition_id);
}

// Save editions for a user. Ids that don't match a real edition are skipped
// rather than failing the whole request (a stale ?build= link can carry one).
export async function saveEditions(userId: string, editionIds: string[]): Promise<number> {
  if (editionIds.length === 0) return 0;
  await ensureAccountTables();
  const result = await pool.query(
    `insert into saved_tournaments (user_id, edition_id)
     select $1, te.id from tournament_editions te where te.id = any($2::uuid[])
     on conflict (user_id, edition_id) do nothing`,
    [userId, editionIds]
  );
  return result.rowCount ?? 0;
}

export async function unsaveEditions(userId: string, editionIds: string[]): Promise<number> {
  if (editionIds.length === 0) return 0;
  await ensureAccountTables();
  const result = await pool.query(
    `delete from saved_tournaments where user_id = $1 and edition_id = any($2::uuid[])`,
    [userId, editionIds]
  );
  return result.rowCount ?? 0;
}

// The alert subscription (if any) for the same address, so the account page
// can link straight to its preferences instead of making someone sign up twice.
export async function alertsTokenForEmail(email: string): Promise<string | null> {
  const present = await pool.query<{ present: boolean }>(
    `select to_regclass('public.alert_subscribers') is not null as present`
  );
  if (!present.rows[0]?.present) return null;
  const result = await pool.query<{ unsubscribe_token: string }>(
    `select unsubscribe_token from alert_subscribers where email = $1 and active = true`,
    [email]
  );
  return result.rows[0]?.unsubscribe_token ?? null;
}

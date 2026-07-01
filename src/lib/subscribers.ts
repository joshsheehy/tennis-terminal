import { pool } from './db';
import { Category, CATEGORIES, isCategory } from './entry-deadlines';

// Email alert subscribers + a per-(subscriber, deadline) send log so the daily
// alert cron is idempotent and never double-emails. Tables are created lazily
// with `create table if not exists` so a fresh deploy doesn't need a separate
// migration step (mirrors the pattern in /api/setup).

let ensured = false;

export async function ensureSubscriberTables(): Promise<void> {
  if (ensured) return;
  await pool.query(`create extension if not exists pgcrypto;`);
  await pool.query(`
    create table if not exists alert_subscribers (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      active boolean not null default true,
      -- Which tour categories this subscriber wants alerts for
      -- (subset of 'atp','challenger','itf','grandslam').
      categories text[] not null default array['atp','challenger'],
      unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
      created_at timestamptz not null default now(),
      unsubscribed_at timestamptz
    );
  `);
  // Additive migration for tables created before the categories column existed.
  await pool.query(
    `alter table alert_subscribers
       add column if not exists categories text[] not null default array['atp','challenger'];`
  );
  await pool.query(`
    create table if not exists alert_sends (
      id uuid primary key default gen_random_uuid(),
      subscriber_id uuid not null references alert_subscribers(id) on delete cascade,
      alert_key text not null,
      sent_at timestamptz not null default now(),
      unique (subscriber_id, alert_key)
    );
  `);
  ensured = true;
}

export type Subscriber = {
  id: string;
  email: string;
  active: boolean;
  categories: Category[];
  unsubscribe_token: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

// Keep only recognised categories; fall back to the sensible default when a
// caller sends nothing valid.
export function normalizeCategories(input: unknown): Category[] {
  const arr = Array.isArray(input) ? input : [];
  const valid = arr
    .map((c) => String(c).trim().toLowerCase())
    .filter(isCategory) as Category[];
  const deduped = Array.from(new Set(valid));
  return deduped.length ? deduped : (['atp', 'challenger'] as Category[]);
}

// Add (or update) a subscriber. Idempotent on email; re-subscribing also
// refreshes the chosen categories and reactivates.
export async function upsertSubscriber(
  rawEmail: string,
  categories: Category[]
): Promise<Subscriber> {
  await ensureSubscriberTables();
  const email = rawEmail.trim().toLowerCase();
  const result = await pool.query<Subscriber>(
    `
    insert into alert_subscribers (email, categories)
    values ($1, $2)
    on conflict (email) do update
      set active = true, unsubscribed_at = null, categories = excluded.categories
    returning id, email, active, categories, unsubscribe_token
    `,
    [email, categories]
  );
  return result.rows[0];
}

export async function listActiveSubscribers(): Promise<Subscriber[]> {
  await ensureSubscriberTables();
  const result = await pool.query<Subscriber>(
    `select id, email, active, categories, unsubscribe_token
       from alert_subscribers
      where active = true
      order by created_at asc`
  );
  return result.rows;
}

// Look up a subscriber by their token (the same token used for unsubscribe
// links). Used by the "edit preferences" page. Returns null for unknown tokens.
export async function getSubscriberByToken(token: string): Promise<Subscriber | null> {
  await ensureSubscriberTables();
  if (!token) return null;
  const result = await pool.query<Subscriber>(
    `select id, email, active, categories, unsubscribe_token
       from alert_subscribers
      where unsubscribe_token = $1`,
    [token]
  );
  return result.rows[0] ?? null;
}

// Update a subscriber's chosen categories via their token. Editing preferences
// also re-activates a previously-unsubscribed address. Returns the updated
// subscriber, or null if the token is unknown.
export async function updateCategoriesByToken(
  token: string,
  categories: Category[]
): Promise<Subscriber | null> {
  await ensureSubscriberTables();
  const result = await pool.query<Subscriber>(
    `update alert_subscribers
        set categories = $2, active = true, unsubscribed_at = null
      where unsubscribe_token = $1
      returning id, email, active, categories, unsubscribe_token`,
    [token, categories]
  );
  return result.rows[0] ?? null;
}

export async function unsubscribeByToken(token: string): Promise<string | null> {
  await ensureSubscriberTables();
  const result = await pool.query<{ email: string }>(
    `update alert_subscribers
        set active = false, unsubscribed_at = now()
      where unsubscribe_token = $1
      returning email`,
    [token]
  );
  return result.rows[0]?.email ?? null;
}

// Try to claim an (subscriber, alert_key) send. Returns true if this call won
// the claim (i.e. it hasn't been sent before), false if already sent. Insert
// happens before the actual email so concurrent cron runs can't double-send.
export async function claimSend(subscriberId: string, alertKey: string): Promise<boolean> {
  await ensureSubscriberTables();
  const result = await pool.query(
    `insert into alert_sends (subscriber_id, alert_key)
     values ($1, $2)
     on conflict (subscriber_id, alert_key) do nothing
     returning id`,
    [subscriberId, alertKey]
  );
  return (result.rowCount ?? 0) > 0;
}

// Undo a claim (used when the actual email send fails, so the next cron run
// retries instead of silently skipping).
export async function releaseSend(subscriberId: string, alertKey: string): Promise<void> {
  await pool.query(
    `delete from alert_sends where subscriber_id = $1 and alert_key = $2`,
    [subscriberId, alertKey]
  );
}

// Re-export so callers can reference the canonical list without a second import.
export { CATEGORIES };

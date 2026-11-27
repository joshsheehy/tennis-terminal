import { ensureByesColumn, pool } from '@/lib/db';

let ready: Promise<void> | null = null;

/** Tables and columns the weekly cut-after-alternates pass needs. Safe to call on every request. */
export function ensureAfterAltsSchema(): Promise<void> {
  ready ??= (async () => {
    await ensureByesColumn();
    await pool.query(`
      create table if not exists ranking_snapshots (
        kind text not null,               -- 'singles' | 'doubles'
        list_date date not null,          -- the Rankings Date of the list
        players jsonb not null,           -- [[rank, surname, first, country], …]
        player_count int not null,
        first_seen timestamptz not null default now(),
        last_seen timestamptz not null default now(),  -- last time it was still the published list
        primary key (kind, list_date)
      )`);
    // Who got in as an alternate, as read from the draw sheet's bracket, and when it was last read.
    await pool.query('alter table cutoff_snapshots add column if not exists alt_entrants jsonb');
    await pool.query('alter table cutoff_snapshots add column if not exists alt_read_at timestamptz');
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

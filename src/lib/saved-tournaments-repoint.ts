import type { PoolClient } from 'pg';

// saved_tournaments rows reference an edition and cascade-delete with it. The
// dedupe/merge tools delete the losing edition of a duplicate pair, so without
// this every merge would silently drop it from people's saved schedules. Call
// it inside the merge transaction, before the losing edition is deleted —
// the same moment cutoff_snapshots are copied across.

type Queryable = Pick<PoolClient, 'query'>;

export async function savedTournamentsTableExists(client: Queryable): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    `select to_regclass('public.saved_tournaments') is not null as present`
  );
  return Boolean(result.rows[0]?.present);
}

// Move saves from `fromEditionId` onto `toEditionId`. Someone who had saved
// both keeps a single row. No-op when the table hasn't been created yet.
export async function repointSavedTournaments(
  client: Queryable,
  fromEditionId: string,
  toEditionId: string
): Promise<void> {
  if (fromEditionId === toEditionId) return;
  if (!(await savedTournamentsTableExists(client))) return;
  await client.query(
    `insert into saved_tournaments (user_id, edition_id, created_at)
     select user_id, $2::uuid, created_at from saved_tournaments where edition_id = $1::uuid
     on conflict (user_id, edition_id) do nothing`,
    [fromEditionId, toEditionId]
  );
}

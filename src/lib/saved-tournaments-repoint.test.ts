import { describe, expect, it } from 'vitest';
import { repointSavedTournaments } from './saved-tournaments-repoint';

// A stand-in for a pg client that records each query and answers the
// table-exists probe.
function fakeClient(tableExists: boolean) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ present: tableExists }] };
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('repointSavedTournaments', () => {
  it('copies saves from the losing edition onto the survivor, keeping one row per user', async () => {
    const client = fakeClient(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repointSavedTournaments(client as any, 'loser', 'winner');
    const insert = client.calls.find((c) => c.sql.includes('insert into saved_tournaments'));
    expect(insert?.params).toEqual(['loser', 'winner']);
    expect(insert?.sql).toContain('on conflict (user_id, edition_id) do nothing');
  });

  it('does nothing before the accounts tables exist', async () => {
    const client = fakeClient(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repointSavedTournaments(client as any, 'loser', 'winner');
    expect(client.calls.some((c) => c.sql.includes('insert'))).toBe(false);
  });

  it('skips a self-merge without touching the database', async () => {
    const client = fakeClient(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repointSavedTournaments(client as any, 'same', 'same');
    expect(client.calls).toHaveLength(0);
  });
});

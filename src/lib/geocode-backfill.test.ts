import { describe, expect, it, vi } from 'vitest';
import { applyCoordinateOverrides } from './geocode-backfill';

type Row = { id: string; city: string; country: string | null; latitude: number | null; longitude: number | null };

function fakeDb(rows: Row[]) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('select')) {
      const patterns = (params?.[0] as string[]).map((p) => p.replace('%', ''));
      return { rows: rows.filter((r) => patterns.some((p) => r.city.toLowerCase().startsWith(p))) };
    }
    return { rows: [] };
  });
  return { query } as unknown as Parameters<typeof applyCoordinateOverrides>[0] & { query: typeof query };
}

describe('applyCoordinateOverrides', () => {
  it('moves Bali rows stored at the island centroid and leaves corrected or unrelated rows alone', async () => {
    const db = fakeDb([
      { id: 'centroid', city: 'Bali', country: 'Indonesia', latitude: -8.2271303, longitude: 115.1919203 },
      { id: 'numbered', city: 'Bali 2', country: 'Indonesia', latitude: -8.2271303, longitude: 115.1919203 },
      { id: 'done', city: 'Bali', country: 'Indonesia', latitude: -8.8017, longitude: 115.2239 },
      { id: 'other-country', city: 'Balikpapan', country: 'Indonesia', latitude: -1.2, longitude: 116.8 },
    ]);

    expect(await applyCoordinateOverrides(db)).toEqual(['centroid', 'numbered']);
    const updates = db.query.mock.calls.filter(([sql]) => sql.startsWith('update'));
    expect(updates.map(([, params]) => params)).toEqual([
      [-8.8017, 115.2239, 'centroid'],
      [-8.8017, 115.2239, 'numbered'],
    ]);
  });
});

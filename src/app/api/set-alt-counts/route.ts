import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Corrects "N alternates got in" counts in bulk, from a count of the Alt entries
// in each draw sheet's bracket. Older sheet layouts were counted as 0, which put
// "0 ALT" beside a "311 after alts" line.
//
// A count is only ever raised, never lowered, and the dry run lists the stored
// value beside the new one.
//
//   GET /api/set-alt-counts?items=slug:year:event:draw:N,…            — dry run
//   GET /api/set-alt-counts?items=…&apply=true

const MAX_ITEMS = 250;

type Item = { slug: string; year: number; event: string; draw: string; count: number };

function parseItem(piece: string): Item | null {
  const [slug, year, event, draw, count] = piece.split(':').map((x) => x.trim().toLowerCase());
  const item = { slug, year: Number(year), event, draw, count: Number(count) };
  if (!slug || !Number.isInteger(item.year)) return null;
  if (event !== 'singles' && event !== 'doubles') return null;
  if (draw !== 'main' && draw !== 'qualifying') return null;
  // A draw holds at most a few dozen alternates; anything larger is a ranking passed by mistake.
  if (!Number.isInteger(item.count) || item.count < 1 || item.count > 64) return null;
  return item;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const apply = params.get('apply') === 'true';
  const pieces = (params.get('items') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!pieces.length || pieces.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `items= needs 1 to ${MAX_ITEMS} entries (slug:year:event:draw:N)` },
      { status: 400 }
    );
  }

  const invalid: string[] = [];
  const missing: string[] = [];
  const changes: Array<[string, number | null, number]> = [];
  let unchanged = 0;

  for (const piece of pieces) {
    const item = parseItem(piece);
    if (!item) {
      invalid.push(piece);
      continue;
    }
    const row = await pool.query<{ id: string; prev: number | null }>(
      `select cs.id, cs.alternate_entries_count as prev
       from cutoff_snapshots cs
       join tournament_editions te on te.id = cs.tournament_edition_id
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.year = $2 and cs.event_type = $3 and cs.draw_type = $4
       limit 1`,
      [item.slug, item.year, item.event, item.draw]
    );
    const found = row.rows[0];
    if (!found) {
      missing.push(piece);
      continue;
    }
    if (found.prev !== null && found.prev >= item.count) {
      unchanged += 1;
      continue;
    }
    changes.push([`${item.slug}:${item.year}:${item.event}:${item.draw}`, found.prev, item.count]);
    if (apply) {
      await pool.query(
        'update cutoff_snapshots set alternate_entries_count = $2, updated_at = now() where id = $1',
        [found.id, item.count]
      );
    }
  }

  return NextResponse.json({ ok: true, apply, received: pieces.length, unchanged, changeCount: changes.length, changes, missing, invalid });
}

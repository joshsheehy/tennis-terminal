import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ensureAfterAltsSchema } from '@/lib/after-alts-store';
import { computeAfterAlts, indexRanking, pickSnapshot, rankingDateFor, type RankedPlayer, type RankingIndex } from '@/lib/after-alts';
import { extractDrawAlternates, type DrawAlternates } from '@/lib/draw-alternates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The weekly "cut after alts" pass (run by .github/workflows/after-alts.yml).
//
//   GET  /api/after-alts?targets=true&days=10&limit=30  — draw sheets to read again (alternates keep
//                                                          getting in after the draw is first posted)
//   POST /api/after-alts {slug,year,event,draw,url,pdfBase64}
//                                                        — read one sheet's alternates (never touches cuts)
//   GET  /api/after-alts?days=21[&apply=true]            — compute from the stored alternates and rankings
//
// A value is written only when every alternate is placed on the right week's list. An incomplete draw is
// left as it is, and a hand-entered after-alts number is never replaced.

const PDF_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(protennislive\.com|atptour\.com)\//i;

function intParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

async function targets(days: number, limit: number) {
  const rows = await pool.query<{ slug: string; year: number; event: string; draw: string; source_notes: string }>(
    `select t.slug, te.year, cs.event_type as event, cs.draw_type as draw, cs.source_notes
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held' and te.level not ilike 'ITF%'
       and te.start_date >= current_date - $1::int and te.start_date <= current_date + 3
       and cs.source_notes like '%.pdf%'
       and (cs.alt_read_at is null or cs.alt_read_at < now() - interval '20 hours')
     order by cs.alt_read_at asc nulls first, te.start_date desc, t.slug
     limit $2`,
    [days, limit]
  );
  return rows.rows.flatMap((row) => {
    const url = row.source_notes.match(/https:\/\/[^\s|]+?\.pdf/i)?.[0];
    return url && PDF_HOSTS.test(url) ? [{ slug: row.slug, year: row.year, event: row.event, draw: row.draw, url }] : [];
  });
}

type SnapshotRow = { kind: string; listDate: string; lastSeen: string; count: number };

async function compute(days: number, apply: boolean) {
  const rows = await pool.query<{
    id: string; slug: string; year: number; event: string; draw: string; start_date: string;
    alt_entrants: DrawAlternates; floor: number; real: number | null; best: number | null; lowest: number | null; unranked: boolean | null;
  }>(
    `select cs.id, t.slug, te.year, cs.event_type as event, cs.draw_type as draw,
            to_char(te.start_date, 'YYYY-MM-DD') as start_date, cs.alt_entrants,
            greatest(coalesce(cs.last_direct_acceptance_rank, 0), coalesce(cs.challenger_doubles_advanced_cut_rank, 0),
                     coalesce(cs.challenger_doubles_onsite_cut_rank, 0)) as floor,
            cs.last_alternate_rank as real, cs.alt_best_rank as best, cs.alt_lowest_rank as lowest, cs.alt_unranked as unranked
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.alt_entrants is not null and te.start_date >= current_date - $1::int
     order by te.start_date desc, t.slug`,
    [days]
  );

  const listed = await pool.query<SnapshotRow>(
    `select kind, to_char(list_date, 'YYYY-MM-DD') as "listDate", last_seen::text as "lastSeen", player_count as count
     from ranking_snapshots`
  );
  const cache = new Map<string, RankingIndex>();
  async function indexFor(kind: string, date: string): Promise<RankingIndex | null> {
    const snapshot = pickSnapshot(listed.rows.filter((s) => s.kind === kind), date);
    if (!snapshot) return null;
    const key = `${kind}:${snapshot.listDate}`;
    if (!cache.has(key)) {
      const found = await pool.query<{ players: RankedPlayer[] }>(
        'select players from ranking_snapshots where kind = $1 and list_date = $2',
        [kind, snapshot.listDate]
      );
      cache.set(key, indexRanking(found.rows[0].players));
    }
    return cache.get(key) as RankingIndex;
  }

  const changes: Array<Record<string, unknown>> = [];
  const waiting: Record<string, string[]> = {};
  let unchanged = 0;
  const wait = (reason: string, key: string) => (waiting[reason] ??= []).push(key);

  for (const row of rows.rows) {
    const key = `${row.slug}:${row.year}:${row.event}:${row.draw}`;
    const alternates = row.alt_entrants;
    if (!alternates.count) continue;
    // A number with nothing behind it was typed in by hand: leave it.
    if (row.real !== null && row.lowest === null && row.unranked === null) {
      wait('hand-entered after-alts number', key);
      continue;
    }
    const target = rankingDateFor(row.start_date);
    const singles = await indexFor('singles', target);
    if (!singles) {
      wait(`no singles ranking list for ${target}`, key);
      continue;
    }
    const doubles = alternates.event === 'doubles' ? await indexFor('doubles', target) : null;
    const result = computeAfterAlts(alternates, singles, doubles);
    if (!result.complete) {
      wait(result.reason, key);
      continue;
    }
    const afterAlt = result.lowest !== null && row.floor > 0 && result.lowest > row.floor ? result.lowest : null;
    // A team or player with no ranking leaves best/lowest describing only the others, if any.
    const same = row.best === result.best && row.lowest === result.lowest && Boolean(row.unranked) === result.unranked && row.real === afterAlt;
    if (same) {
      unchanged += 1;
      continue;
    }
    changes.push({
      key, floor: row.floor, rankingDate: target,
      was: { lowest: row.lowest, afterAlt: row.real, unranked: Boolean(row.unranked) },
      now: { lowest: result.lowest, afterAlt, unranked: result.unranked },
    });
    if (apply) {
      await pool.query(
        `update cutoff_snapshots
         set alt_best_rank = $2, alt_lowest_rank = $3, alt_unranked = $4, last_alternate_rank = $5,
             last_alternate_player_name = null, updated_at = now()
         where id = $1`,
        [row.id, result.best, result.lowest, result.unranked, afterAlt]
      );
    }
  }
  return {
    drawsWithAlternates: rows.rows.filter((r) => r.alt_entrants.count).length,
    unchanged,
    changeCount: changes.length,
    changes,
    waiting,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  await ensureAfterAltsSchema();
  if (params.get('targets') === 'true') {
    const list = await targets(intParam(params.get('days'), 10, 400), intParam(params.get('limit'), 30, 200));
    return NextResponse.json({ ok: true, count: list.length, targets: list });
  }
  const apply = params.get('apply') === 'true';
  return NextResponse.json({ ok: true, apply, ...(await compute(intParam(params.get('days'), 21, 400), apply)) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = String(body?.slug ?? '');
  const year = Number(body?.year);
  const event = String(body?.event ?? '');
  const draw = String(body?.draw ?? '');
  const buffer = Buffer.from(String(body?.pdfBase64 ?? ''), 'base64');
  if (!slug || !Number.isInteger(year) || !['singles', 'doubles'].includes(event) || !['main', 'qualifying'].includes(draw)) {
    return NextResponse.json({ ok: false, error: 'Required: slug, year, event, draw, pdfBase64' }, { status: 400 });
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-' || buffer.length > 12 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'Body is not a PDF' }, { status: 400 });
  }
  const alternates = await extractDrawAlternates(buffer);
  if (!alternates) return NextResponse.json({ ok: false, error: 'The PDF text could not be read' }, { status: 422 });

  await ensureAfterAltsSchema();
  // The title says which event the sheet is; a mismatch means the wrong file, so store nothing.
  const matches = alternates.event === event || !alternates.count;
  const result = matches
    ? await pool.query(
        `update cutoff_snapshots cs
         set alt_entrants = $5::jsonb, alt_read_at = now(),
             alternate_entries_count = greatest(coalesce(cs.alternate_entries_count, 0), $6::int)
         from tournament_editions te join tournaments t on t.id = te.tournament_id
         where cs.tournament_edition_id = te.id and t.slug = $1 and te.year = $2
           and cs.event_type = $3 and cs.draw_type = $4`,
        [slug, year, event, draw, JSON.stringify(alternates), alternates.count]
      )
    : null;
  return NextResponse.json({
    ok: true,
    stored: Boolean(result?.rowCount),
    eventOnSheet: alternates.event,
    alternates: alternates.count,
    complete: alternates.complete,
  });
}

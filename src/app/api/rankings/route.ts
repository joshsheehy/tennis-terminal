import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ensureAfterAltsSchema } from '@/lib/after-alts-store';
import { extractRankingList } from '@/lib/ranking-pdf';
import type { RankedPlayer } from '@/lib/after-alts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Weekly ranking snapshots used for "cut after alts".
//
//   GET  /api/rankings                       — what is stored
//   POST /api/rankings {pdfBase64}           — the official singles list PDF (posting/ramr/…)
//   POST /api/rankings {kind, listDate, players:[[rank,surname,first,country],…], lastSeen?}
//                                            — a list gathered elsewhere (doubles has no PDF)
//
// The singles PDF only ever holds the current list, so it is captured as it appears. Posting a list that
// is already stored just records that it is still the published one.

// A short list silently drops lower-ranked players and gets them called "unranked", so reject it.
const MIN_PLAYERS = { singles: 1500, doubles: 2000 } as const;

export async function GET() {
  await ensureAfterAltsSchema();
  const rows = await pool.query(
    `select kind, to_char(list_date, 'YYYY-MM-DD') as "listDate", player_count as players, last_seen as "lastSeen"
     from ranking_snapshots order by list_date desc, kind limit 60`
  );
  return NextResponse.json({ ok: true, snapshots: rows.rows });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 });

  let kind: 'singles' | 'doubles';
  let listDate: string;
  let players: RankedPlayer[];
  if (typeof body.pdfBase64 === 'string') {
    const buffer = Buffer.from(body.pdfBase64, 'base64');
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ ok: false, error: 'Body is not a PDF' }, { status: 400 });
    }
    const list = await extractRankingList(buffer);
    if (!list) return NextResponse.json({ ok: false, error: 'No ranking list found in the PDF' }, { status: 422 });
    kind = 'singles';
    ({ listDate, players } = list);
  } else {
    kind = body.kind === 'doubles' ? 'doubles' : 'singles';
    listDate = String(body.listDate ?? '');
    players = Array.isArray(body.players) ? (body.players as RankedPlayer[]) : [];
    const valid = players.every((p) => Array.isArray(p) && Number.isInteger(p[0]) && typeof p[1] === 'string' && typeof p[2] === 'string');
    if (!valid) return NextResponse.json({ ok: false, error: 'players must be [rank, surname, first, country]' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listDate)) {
    return NextResponse.json({ ok: false, error: 'listDate must be YYYY-MM-DD' }, { status: 400 });
  }
  if (players.length < MIN_PLAYERS[kind]) {
    return NextResponse.json(
      { ok: false, error: `Only ${players.length} players: a full ${kind} list has at least ${MIN_PLAYERS[kind]}` },
      { status: 422 }
    );
  }
  const lastSeen = typeof body.lastSeen === 'string' && !Number.isNaN(Date.parse(body.lastSeen)) ? body.lastSeen : null;

  await ensureAfterAltsSchema();
  const result = await pool.query<{ inserted: boolean }>(
    `insert into ranking_snapshots (kind, list_date, players, player_count, last_seen)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
     on conflict (kind, list_date) do update
       set players = excluded.players, player_count = excluded.player_count,
           last_seen = greatest(ranking_snapshots.last_seen, excluded.last_seen)
     returning (xmax = 0) as inserted`,
    [kind, listDate, JSON.stringify(players), players.length, lastSeen]
  );
  return NextResponse.json({ ok: true, kind, listDate, players: players.length, isNew: result.rows[0]?.inserted ?? false });
}

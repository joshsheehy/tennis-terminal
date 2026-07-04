import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';
import { SLAM_CUTS, type SlamCutEntry } from '@/lib/slam-cuts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Imports Grand Slam cuts. Two paths, same fill-only semantics (a snapshot
// that already carries a cut is never overwritten, so re-running is free and
// manual DB corrections survive):
//
//   GET  /api/import-slam-cuts[?apply=true]   — the hand-verified, checked-in
//        dataset from src/lib/slam-cuts.ts (runs nightly).
//   POST /api/import-slam-cuts?apply=true     — rows scraped off-server by
//        scripts/scrape-slam-cuts.mjs on a GitHub runner (sources like
//        menstennisforums.com and wimbledon.com block datacenter traffic but
//        are reachable there). Body: { rows: SlamCutEntry[] }.
//
// Slams have no ProTennisLive acceptance lists, which is why they get their
// own import path at all.

type ImportResult = {
  slug: string;
  year: number;
  event: string;
  draw: string;
  cut: number;
  action: 'inserted' | 'filled' | 'exists' | 'no-edition' | 'not-a-slam' | 'preview';
  existingCut?: number | null;
};

async function importEntries(entries: SlamCutEntry[], apply: boolean) {
  const results: ImportResult[] = [];
  let written = 0;

  for (const entry of entries) {
    const editionResult = await pool.query<{ id: string; level: string }>(
      `select te.id, te.level
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.year = $2
       limit 1`,
      [entry.slug, entry.year]
    );
    const edition = editionResult.rows[0] ?? null;
    const base = {
      slug: entry.slug,
      year: entry.year,
      event: entry.eventType,
      draw: entry.drawType,
      cut: entry.cut,
    };
    if (!edition) {
      results.push({ ...base, action: 'no-edition' });
      continue;
    }
    // This importer is for slams only — it must not be able to touch ATP or
    // Challenger snapshots even with a crafted payload.
    if (!edition.level.startsWith('Grand Slam')) {
      results.push({ ...base, action: 'not-a-slam' });
      continue;
    }

    const existing = await pool.query<{ rank: number | null }>(
      `select last_direct_acceptance_rank as rank
       from cutoff_snapshots
       where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
      [edition.id, entry.eventType, entry.drawType]
    );
    const row = existing.rows[0];
    if (row && row.rank != null) {
      results.push({ ...base, action: 'exists', existingCut: row.rank });
      continue;
    }

    const notes = `${entry.note ?? 'Grand Slam entry-list cut.'} | Source: ${entry.source}`;
    if (apply) {
      if (row) {
        await pool.query(
          `update cutoff_snapshots
           set last_direct_acceptance_rank = $4,
               last_direct_acceptance_player_name = null,
               source_type = 'slam_entry_list_v1',
               parser_version = 'manual',
               source_notes = $5,
               updated_at = now()
           where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
          [edition.id, entry.eventType, entry.drawType, entry.cut, notes]
        );
      } else {
        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             alternate_entries_count, lucky_loser_count,
             parsed_at, parser_version, source_notes, updated_at
           )
           values ($1, $2, $3, 'slam_entry_list_v1', $4, null, 0, 0, now(), 'manual', $5, now())`,
          [edition.id, entry.eventType, entry.drawType, entry.cut, notes]
        );
      }
      written += 1;
    }
    results.push({
      ...base,
      action: apply ? (row ? 'filled' : 'inserted') : 'preview',
      existingCut: row?.rank ?? null,
    });
  }

  if (written > 0) {
    try {
      revalidateTag('schedule');
    } catch {
      // revalidateTag can throw outside the cache runtime; safe to swallow.
    }
  }
  return { results, written };
}

function respond(apply: boolean, totalEntries: number, outcome: Awaited<ReturnType<typeof importEntries>>) {
  return NextResponse.json({
    ok: true,
    apply,
    totalEntries,
    written: outcome.written,
    results: outcome.results,
    message: apply
      ? 'Slam cuts imported (fill-only; existing cuts untouched).'
      : 'Dry run. Append ?apply=true to write.',
  });
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const outcome = await importEntries(SLAM_CUTS, apply);
  return respond(apply, SLAM_CUTS.length, outcome);
}

const MAX_ROWS = 100;

function validateRow(raw: unknown): { row?: SlamCutEntry; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'row is not an object' };
  const r = raw as Record<string, unknown>;
  const slug = String(r.slug ?? '').trim();
  const year = Number(r.year);
  const eventType = String(r.eventType ?? '');
  const drawType = String(r.drawType ?? '');
  const cut = Number(r.cut);
  const source = String(r.source ?? '').trim();
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: `bad slug "${r.slug}"` };
  if (!Number.isInteger(year) || year < 2020 || year > 2030) return { error: `bad year "${r.year}"` };
  if (eventType !== 'singles' && eventType !== 'doubles') return { error: `bad eventType "${r.eventType}"` };
  if (drawType !== 'main' && drawType !== 'qualifying') return { error: `bad drawType "${r.drawType}"` };
  if (!Number.isInteger(cut) || cut < 3 || cut > 2000) return { error: `bad cut "${r.cut}"` };
  if (!/^https?:\/\//.test(source)) return { error: 'source must be a URL' };
  return {
    row: {
      slug,
      year,
      eventType,
      drawType,
      cut,
      source,
      note: r.note ? String(r.note).slice(0, 400) : undefined,
    },
  };
}

export async function POST(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const body = await request.json().catch(() => null);
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json(
      { ok: false, error: `body must be { rows: [...] } with 1-${MAX_ROWS} rows` },
      { status: 400 }
    );
  }
  const invalid: Array<{ index: number; error: string }> = [];
  const entries: SlamCutEntry[] = [];
  rows.forEach((raw, index) => {
    const { row, error } = validateRow(raw);
    if (row) entries.push(row);
    else invalid.push({ index, error: error ?? 'invalid' });
  });
  if (invalid.length > 0) {
    return NextResponse.json({ ok: false, error: 'invalid rows', invalid }, { status: 400 });
  }
  const outcome = await importEntries(entries, apply);
  return respond(apply, entries.length, outcome);
}

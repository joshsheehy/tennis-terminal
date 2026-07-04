import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';
import { SLAM_CUTS } from '@/lib/slam-cuts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Imports the hand-researched Grand Slam cuts from src/lib/slam-cuts.ts.
// Fill-only and idempotent: a snapshot that already carries a cut is left
// alone, so re-running nightly is free and manual corrections in the DB
// survive. Slams have no ProTennisLive acceptance lists, so this checked-in,
// source-attributed dataset is the import path for them.
//
//   GET /api/import-slam-cuts             → dry run (report what would change)
//   GET /api/import-slam-cuts?apply=true  → write

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const results: Array<{
    slug: string;
    year: number;
    event: string;
    draw: string;
    cut: number;
    action: 'inserted' | 'filled' | 'exists' | 'no-edition' | 'preview';
    existingCut?: number | null;
  }> = [];
  let written = 0;

  for (const entry of SLAM_CUTS) {
    const editionResult = await pool.query<{ id: string }>(
      `select te.id
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.year = $2
       limit 1`,
      [entry.slug, entry.year]
    );
    const editionId = editionResult.rows[0]?.id ?? null;
    if (!editionId) {
      results.push({
        slug: entry.slug,
        year: entry.year,
        event: entry.eventType,
        draw: entry.drawType,
        cut: entry.cut,
        action: 'no-edition',
      });
      continue;
    }

    const existing = await pool.query<{ rank: number | null }>(
      `select last_direct_acceptance_rank as rank
       from cutoff_snapshots
       where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
      [editionId, entry.eventType, entry.drawType]
    );
    const row = existing.rows[0];
    if (row && row.rank != null) {
      results.push({
        slug: entry.slug,
        year: entry.year,
        event: entry.eventType,
        draw: entry.drawType,
        cut: entry.cut,
        action: 'exists',
        existingCut: row.rank,
      });
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
          [editionId, entry.eventType, entry.drawType, entry.cut, notes]
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
          [editionId, entry.eventType, entry.drawType, entry.cut, notes]
        );
      }
      written += 1;
    }
    results.push({
      slug: entry.slug,
      year: entry.year,
      event: entry.eventType,
      draw: entry.drawType,
      cut: entry.cut,
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

  return NextResponse.json({
    ok: true,
    apply,
    totalEntries: SLAM_CUTS.length,
    written,
    results,
    message: apply
      ? 'Slam cuts imported (fill-only; existing cuts untouched).'
      : 'Dry run. Append ?apply=true to write.',
  });
}

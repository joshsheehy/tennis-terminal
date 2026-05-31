import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manual cut setter — for cuts found by hand (e.g. ATP PlayerZone) when the
// official draw-sheet PDF doesn't print a "LAST DIRECT ACCEPTANCE" line, so the
// automatic parser can't extract one (or extracted garbage).
//
// It overwrites ONLY the last_direct_acceptance_rank (+ name/source metadata)
// on the matching cutoff_snapshots row. It deliberately leaves
// alternate_entries_count, lucky_loser_count and last_alternate_* untouched so
// the ALT/LL figures parsed from the real draw PDFs survive.
//
// Usage:
//   GET /api/set-cut
//     ?slug=bnp-paribas-fortis-european-open-brussels
//     &year=2025
//     &cuts=singles:main:89,singles:qualifying:163,doubles:main:163
//     &notes=ATP%20PlayerZone%202025%20cut-offs%20(post-withdrawal%20number)
//     &apply=true            (omit for a dry run)
//
// Each cut is "event:draw:rank" — event in {singles,doubles}, draw in
// {main,qualifying}, rank a positive integer.

type ParsedCut = { event_type: 'singles' | 'doubles'; draw_type: 'main' | 'qualifying'; rank: number };

function parseCuts(raw: string): { cuts: ParsedCut[]; error: string | null } {
  const cuts: ParsedCut[] = [];
  for (const piece of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [event, draw, rankStr] = piece.split(':').map((p) => p.trim().toLowerCase());
    if (event !== 'singles' && event !== 'doubles') return { cuts: [], error: `bad event in "${piece}" (use singles|doubles)` };
    if (draw !== 'main' && draw !== 'qualifying') return { cuts: [], error: `bad draw in "${piece}" (use main|qualifying)` };
    const rank = Number(rankStr);
    if (!Number.isInteger(rank) || rank < 1) return { cuts: [], error: `bad rank in "${piece}" (use a positive integer)` };
    cuts.push({ event_type: event, draw_type: draw, rank });
  }
  return { cuts, error: null };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get('slug');
  const year = Number(params.get('year'));
  const cutsRaw = params.get('cuts');
  const notes = params.get('notes') ?? '';
  const apply = params.get('apply') === 'true';

  if (!slug || !Number.isInteger(year) || !cutsRaw) {
    return NextResponse.json(
      { ok: false, error: 'Required: slug, year, cuts=event:draw:rank[,event:draw:rank...]; optional notes, apply=true' },
      { status: 400 }
    );
  }

  const { cuts, error } = parseCuts(cutsRaw);
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });

  const editionResult = await pool.query<{ id: string; name: string; city: string }>(
    `select te.id, t.name, t.city
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.year = $2
     limit 1`,
    [slug, year]
  );

  if (!editionResult.rows[0]) {
    // Help the operator find the right slug: surface same-year editions that
    // share any token with the requested slug.
    const tokens = slug.split('-').filter((t) => t.length > 2);
    const suggestions = await pool.query<{ slug: string; name: string; city: string }>(
      `select distinct t.slug, t.name, t.city
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where te.year = $1
         and (${tokens.map((_, i) => `t.slug ilike $${i + 2}`).join(' or ') || 'false'})
       order by t.slug
       limit 20`,
      [year, ...tokens.map((t) => `%${t}%`)]
    );
    return NextResponse.json(
      {
        ok: false,
        error: `No ${year} edition found for slug "${slug}".`,
        didYouMean: suggestions.rows,
      },
      { status: 404 }
    );
  }

  const editionId = editionResult.rows[0].id;
  const results: Array<Record<string, unknown>> = [];

  for (const cut of cuts) {
    const before = await pool.query<{
      last_direct_acceptance_rank: number | null;
      last_direct_acceptance_player_name: string | null;
      alternate_entries_count: number | null;
      lucky_loser_count: number | null;
    }>(
      `select last_direct_acceptance_rank, last_direct_acceptance_player_name,
              alternate_entries_count, lucky_loser_count
       from cutoff_snapshots
       where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
      [editionId, cut.event_type, cut.draw_type]
    );

    const existed = before.rows.length > 0;
    const sourceNotes = notes || `Manual cut set via set-cut: ${cut.event_type} ${cut.draw_type} = ${cut.rank}.`;

    if (apply) {
      if (existed) {
        // Update ONLY the direct-acceptance cut; preserve ALT/LL fields.
        await pool.query(
          `update cutoff_snapshots
           set last_direct_acceptance_rank = $4,
               last_direct_acceptance_player_name = null,
               source_type = 'manual_playerzone_v1',
               parser_version = 'manual',
               source_notes = $5,
               updated_at = now()
           where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
          [editionId, cut.event_type, cut.draw_type, cut.rank, sourceNotes]
        );
      } else {
        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             alternate_entries_count, lucky_loser_count,
             parsed_at, parser_version, source_notes, updated_at
           )
           values ($1, $2, $3, 'manual_playerzone_v1', $4, null, null, 0, now(), 'manual', $5, now())`,
          [editionId, cut.event_type, cut.draw_type, cut.rank, sourceNotes]
        );
      }
    }

    results.push({
      event: cut.event_type,
      draw: cut.draw_type,
      newRank: cut.rank,
      previousRank: before.rows[0]?.last_direct_acceptance_rank ?? null,
      preservedAlternates: before.rows[0]?.alternate_entries_count ?? null,
      preservedLuckyLosers: before.rows[0]?.lucky_loser_count ?? null,
      rowExisted: existed,
      action: apply ? (existed ? 'updated' : 'inserted') : 'preview',
    });
  }

  return NextResponse.json({
    ok: true,
    apply,
    slug,
    year,
    tournament: editionResult.rows[0].name,
    city: editionResult.rows[0].city,
    cuts: results,
    message: apply ? 'Cut(s) set; ALT/LL preserved.' : 'Dry run. Append &apply=true to write.',
  });
}

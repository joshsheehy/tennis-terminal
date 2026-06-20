import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

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

// Build the canonical ProTennisLive draw-sheet URL for a given (slug, year,
// event, draw). Used so manual cuts still carry a "PDF source" link on the
// tournament page — the page's sourceHref() regex extracts the first
// https://...pdf it finds inside source_notes.
function getPtlCodeForSlug(slug: string): string | null {
  let bestCode: string | null = null;
  let bestYear = -Infinity;
  for (const entry of ALL_EDITIONS) {
    if (entry.tournament.slug !== slug) continue;
    if (!entry.edition.protennislive_code) continue;
    if (entry.edition.year > bestYear) {
      bestYear = entry.edition.year;
      bestCode = entry.edition.protennislive_code;
    }
  }
  return bestCode;
}

function ptlPdfUrlFor(code: string, year: number, event: 'singles' | 'doubles', draw: 'main' | 'qualifying'): string {
  const base = `https://www.protennislive.com/posting/${year}/${code}`;
  // The most common PTL filename convention. Some tournaments use variants
  // (md/ms/ad/dd) but mds/qs/mdd/qdd cover the overwhelming majority — that's
  // enough for "PDF source" to land the viewer on the right draw sheet.
  if (event === 'singles' && draw === 'main') return `${base}/mds.pdf`;
  if (event === 'singles' && draw === 'qualifying') return `${base}/qs.pdf`;
  if (event === 'doubles' && draw === 'main') return `${base}/mdd.pdf`;
  return `${base}/qdd.pdf`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get('slug');
  const year = Number(params.get('year'));
  const cutsRaw = params.get('cuts');
  const realCutsRaw = params.get('realcuts');
  const notes = params.get('notes') ?? '';
  const apply = params.get('apply') === 'true';

  if (!slug || !Number.isInteger(year) || (!cutsRaw && !realCutsRaw)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Required: slug, year, and at least one of cuts= or realcuts= (event:draw:rank[,...]); optional notes, apply=true',
      },
      { status: 400 }
    );
  }

  // `cuts` sets the direct-acceptance rank; `realcuts` sets last_alternate_rank
  // — the hand-sourced "real" rank that ultimately made the main draw after
  // alternates/withdrawals (e.g. Newport: direct 340 but 550 actually got in).
  const { cuts, error } = cutsRaw ? parseCuts(cutsRaw) : { cuts: [], error: null };
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
  const { cuts: realCuts, error: realError } = realCutsRaw
    ? parseCuts(realCutsRaw)
    : { cuts: [], error: null };
  if (realError) return NextResponse.json({ ok: false, error: realError }, { status: 400 });

  // Look up the existing (slug, year) edition. If none exists yet — common
  // for historical years where we only have the canonical 2026 entry in
  // tournament-data.ts — clone the most recent edition for the same slug
  // as a template. Same pattern import-pdf-direct uses. ALT/LL counts on
  // the new row start at 0 (manual cut, no PDF parsed). Year-shifting the
  // start_date keeps the schedule grouping/week math correct.
  let editionResult = await pool.query<{ id: string; name: string; city: string }>(
    `select te.id, t.name, t.city
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.year = $2
     limit 1`,
    [slug, year]
  );

  let createdFromTemplate = false;
  if (!editionResult.rows[0]) {
    const template = await pool.query<{
      tournament_id: string;
      name: string;
      city: string;
      week: number | null;
      start_date: string | Date | null;
      end_date: string | Date | null;
      level: string;
      surface: string;
      indoor: boolean | null;
      source: string;
      source_url: string | null;
    }>(
      `select te.tournament_id, t.name, t.city, te.week,
              te.start_date, te.end_date,
              te.level, te.surface, te.indoor, te.source, te.source_url
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.status = 'held'
       order by te.year desc
       limit 1`,
      [slug]
    );
    const tmpl = template.rows[0];
    if (tmpl) {
      const shiftDate = (raw: string | Date | null): string | null => {
        if (!raw) return null;
        const iso = raw instanceof Date
          ? `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}-${String(raw.getUTCDate()).padStart(2, '0')}`
          : String(raw);
        const parts = iso.split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        const [, month, day] = parts;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };
      const created = await pool.query<{ id: string }>(
        `insert into tournament_editions (
           tournament_id, year, week, start_date, end_date,
           level, surface, indoor, source, source_url, status, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', now())
         on conflict (tournament_id, year) do update set updated_at = now()
         returning id`,
        [
          tmpl.tournament_id, year, tmpl.week,
          shiftDate(tmpl.start_date), shiftDate(tmpl.end_date),
          tmpl.level, tmpl.surface, tmpl.indoor, tmpl.source, tmpl.source_url,
        ]
      );
      const newId = created.rows[0]?.id;
      if (newId) {
        editionResult = {
          ...editionResult,
          rows: [{ id: newId, name: tmpl.name, city: tmpl.city }],
        };
        createdFromTemplate = true;
      }
    }
  }

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
        error: `No ${year} edition found for slug "${slug}" and no template available to create one from.`,
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
    const ptlCode = getPtlCodeForSlug(slug);
    const pdfUrl = ptlCode ? ptlPdfUrlFor(ptlCode, year, cut.event_type, cut.draw_type) : null;
    const baseNotes = notes || `Manual cut set via set-cut: ${cut.event_type} ${cut.draw_type} = ${cut.rank}.`;
    // Append the draw-sheet URL so the tournament page's "PDF source" link
    // keeps working after a manual override (sourceHref greps source_notes
    // for an https://...pdf URL). If we couldn't resolve a PTL code from
    // tournament-data.ts, source_notes is just baseNotes — no link rendered.
    const sourceNotes = pdfUrl ? `${baseNotes} | Draw sheet: ${pdfUrl}` : baseNotes;

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

  // Real (after-alternates) main-draw cuts → last_alternate_rank. Updates the
  // existing row only; the direct cut should already be on record (set it via
  // `cuts` in the same call if not). Leaves source_notes / PDF link intact.
  const realResults: Array<Record<string, unknown>> = [];
  for (const rc of realCuts) {
    const before = await pool.query<{
      last_alternate_rank: number | null;
      last_direct_acceptance_rank: number | null;
    }>(
      `select last_alternate_rank, last_direct_acceptance_rank
       from cutoff_snapshots
       where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
      [editionId, rc.event_type, rc.draw_type]
    );
    const existed = before.rows.length > 0;

    if (apply && existed) {
      await pool.query(
        `update cutoff_snapshots
         set last_alternate_rank = $4,
             last_alternate_player_name = null,
             updated_at = now()
         where tournament_edition_id = $1 and event_type = $2 and draw_type = $3`,
        [editionId, rc.event_type, rc.draw_type, rc.rank]
      );
    }

    realResults.push({
      event: rc.event_type,
      draw: rc.draw_type,
      realRank: rc.rank,
      previousRealRank: before.rows[0]?.last_alternate_rank ?? null,
      directRank: before.rows[0]?.last_direct_acceptance_rank ?? null,
      rowExisted: existed,
      action: apply
        ? existed
          ? 'updated'
          : 'skipped — no row yet; set the direct cut first via cuts='
        : 'preview',
    });
  }

  return NextResponse.json({
    ok: true,
    apply,
    createdHistoricalEdition: createdFromTemplate,
    slug,
    year,
    tournament: editionResult.rows[0].name,
    city: editionResult.rows[0].city,
    cuts: results,
    realCuts: realResults,
    message: apply
      ? 'Cut(s) set; ALT/LL preserved.'
      : 'Dry run. Append &apply=true to write.',
  });
}

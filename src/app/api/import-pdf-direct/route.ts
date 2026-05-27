import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Direct PDF import endpoint — used when automatic discovery misses a PDF
// that is known to exist (found manually on PTL or Wayback).
//
// Usage:
//   GET /api/import-pdf-direct
//     ?url=https://www.protennislive.com/posting/2024/7916/mds.pdf
//     &slug=glasgow-glasgow
//     &year=2024
//     &event=singles       (singles | doubles)
//     &draw=main           (main | qualifying)
//     &archiveFirst=true   (optional — try Wayback before live PTL, default false)
//
// If no tournament_edition exists for the slug+year, one is created by copying
// the most recent known edition for that slug (same pattern as import-cutoffs).

function shiftDateToYear(raw: string | Date | null, year: number): string | null {
  if (!raw) return null;
  const iso = raw instanceof Date
    ? `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}-${String(raw.getUTCDate()).padStart(2, '0')}`
    : String(raw);
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [, month, day] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function getOrCreateEditionId(slug: string, year: number): Promise<string | null> {
  // Try existing edition first
  const existing = await pool.query<{ id: string }>(
    `select te.id from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.year = $2 limit 1`,
    [slug, year]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  // No edition — copy the most recent one as a template
  const template = await pool.query<{
    tournament_id: string; week: number | null;
    start_date: string | Date | null; end_date: string | Date | null;
    level: string; surface: string; indoor: boolean | null;
    source: string; source_url: string | null;
  }>(
    `select te.tournament_id, te.week, te.start_date, te.end_date,
            te.level, te.surface, te.indoor, te.source, te.source_url
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.status = 'held'
     order by te.year desc limit 1`,
    [slug]
  );
  if (!template.rows[0]) return null;

  const t = template.rows[0];
  const created = await pool.query<{ id: string }>(
    `insert into tournament_editions
       (tournament_id, year, week, start_date, end_date, level, surface, indoor,
        source, source_url, status, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'held',now())
     on conflict (tournament_id, year) do update set updated_at = now()
     returning id`,
    [
      t.tournament_id, year, t.week,
      shiftDateToYear(t.start_date, year),
      shiftDateToYear(t.end_date, year),
      t.level, t.surface, t.indoor, t.source, t.source_url,
    ]
  );
  return created.rows[0]?.id ?? null;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const url = sp.get('url');
  const slug = sp.get('slug');
  const yearParam = sp.get('year');
  const event = sp.get('event');
  const draw = sp.get('draw');
  const archiveFirst = sp.get('archiveFirst') === 'true';

  if (!url || !slug || !yearParam || !event || !draw) {
    return NextResponse.json(
      { ok: false, error: 'Required: url, slug, year, event (singles|doubles), draw (main|qualifying)' },
      { status: 400 }
    );
  }

  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }
  if (!['singles', 'doubles'].includes(event)) {
    return NextResponse.json({ ok: false, error: 'event must be singles or doubles' }, { status: 400 });
  }
  if (!['main', 'qualifying'].includes(draw)) {
    return NextResponse.json({ ok: false, error: 'draw must be main or qualifying' }, { status: 400 });
  }
  if (!url.startsWith('https://www.protennislive.com/posting/')) {
    return NextResponse.json({ ok: false, error: 'url must be a protennislive.com/posting/ PDF URL' }, { status: 400 });
  }

  let parsed: Awaited<ReturnType<typeof fetchAndParseOfficialPdfCutoff>>;
  try {
    parsed = await fetchAndParseOfficialPdfCutoff(url, archiveFirst);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `PDF fetch/parse failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const hasRank =
    parsed.last_direct_acceptance_rank !== null ||
    parsed.challenger_doubles_advanced_cut_rank !== null ||
    parsed.challenger_doubles_onsite_cut_rank !== null;

  const editionId = await getOrCreateEditionId(slug, year);
  if (!editionId) {
    return NextResponse.json(
      { ok: false, error: `Tournament slug "${slug}" not found in DB. Run /api/sync-canonical or /api/import-calendars first.` },
      { status: 404 }
    );
  }

  await pool.query(
    `insert into cutoff_snapshots (
       tournament_edition_id, event_type, draw_type, source_type,
       last_direct_acceptance_rank, last_direct_acceptance_player_name,
       last_alternate_rank, last_alternate_player_name,
       challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
       challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
       parsed_at, parser_version, source_notes,
       alternate_entries_count, lucky_loser_count, updated_at
     ) values (
       $1, $2, $3, 'official_pdf',
       $4, $5, null, null, $6, null, $7, null,
       now(), 'official-pdf-bottom-left-v4', $8, $9, $10, now()
     )
     on conflict (tournament_edition_id, event_type, draw_type)
     do update set
       source_type = excluded.source_type,
       last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
       last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
       challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
       challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
       parsed_at = excluded.parsed_at,
       parser_version = excluded.parser_version,
       source_notes = excluded.source_notes,
       alternate_entries_count = excluded.alternate_entries_count,
       lucky_loser_count = excluded.lucky_loser_count,
       updated_at = now()`,
    [
      editionId, event, draw,
      parsed.last_direct_acceptance_rank,
      parsed.last_direct_acceptance_name,
      parsed.challenger_doubles_advanced_cut_rank,
      parsed.challenger_doubles_onsite_cut_rank,
      `Official PDF (direct import): ${url}. Raw: ${parsed.raw_last_direct_acceptance ?? 'not found'}.`,
      parsed.alternate_entries_count,
      parsed.lucky_loser_count,
    ]
  );

  return NextResponse.json({
    ok: true,
    slug,
    year,
    event_type: event,
    draw_type: draw,
    pdf_url: url,
    hasRank,
    last_direct_acceptance_rank: parsed.last_direct_acceptance_rank,
    last_direct_acceptance_name: parsed.last_direct_acceptance_name,
    raw_last_direct_acceptance: parsed.raw_last_direct_acceptance,
    challenger_doubles_advanced_cut_rank: parsed.challenger_doubles_advanced_cut_rank,
    challenger_doubles_onsite_cut_rank: parsed.challenger_doubles_onsite_cut_rank,
    alternate_entries_count: parsed.alternate_entries_count,
    lucky_loser_count: parsed.lucky_loser_count,
    pdf_text_length: parsed.pdf_text_length,
  });
}

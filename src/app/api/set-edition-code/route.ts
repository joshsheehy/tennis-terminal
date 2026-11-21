import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Attaches the right ProTennisLive code to ONE edition (slug + year).
//
// The cut importer takes a tournament's code from its newest edition's
// source_url, falling back to earlier seasons. That breaks when an event moves
// week or a city's numbered events reshuffle: in 2026 Prague's code 600 moved
// from May to August, Oeiras "4" became "Oeiras Open 3", and the calendar
// matched by name, so several 2026 editions inherited a sibling's code and
// showed that other week's cut (Porto 31 Aug showed the 28 Sep event's).
// import-ptl-code.yml can't fix those: it re-derives the slug from the city
// name and would create a new "porto" or "istanbul" tournament.
//
// This writes the posting URL onto the edition's source_url, replacing any
// posting URL already there and keeping the rest (the calendar PDF link). The
// official-calendar upsert preserves a posting URL, and the importer reads the
// edition's own source_url before older seasons, so the code sticks. Run
// /api/import-cutoffs?year=&slug= afterwards to pull that sheet's cuts.
//
//   GET /api/set-edition-code?slug=porto&year=2026&code=2933            — dry run
//   GET /api/set-edition-code?slug=porto&year=2026&code=2933&apply=true

const POSTING = /\s*\|?\s*https?:\/\/www\.protennislive\.com\/posting\/\d+\/\d+\/\S*/g;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = (params.get('slug') ?? '').trim();
  const year = Number(params.get('year'));
  const code = (params.get('code') ?? '').trim();
  const apply = params.get('apply') === 'true';

  if (!/^[a-z0-9-]+$/.test(slug) || !Number.isInteger(year) || !/^\d{2,5}$/.test(code)) {
    return NextResponse.json({ ok: false, error: 'Required: slug, year, code (digits); optional apply=true' }, { status: 400 });
  }

  const found = await pool.query<{ id: string; start_date: string | null; source_url: string | null; status: string }>(
    `select te.id, te.start_date::text as start_date, te.source_url, te.status
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where t.slug = $1 and te.year = $2`,
    [slug, year]
  );
  const edition = found.rows[0];
  if (!edition) {
    return NextResponse.json({ ok: false, error: `No ${year} edition for "${slug}"` }, { status: 404 });
  }

  const posting = `https://www.protennislive.com/posting/${year}/${code}/`;
  const rest = (edition.source_url ?? '').replace(POSTING, '').trim().replace(/\|\s*$/, '').trim();
  const nextSourceUrl = rest ? `${rest} | ${posting}` : posting;

  // Other tournaments that already carry this code in the same season: a
  // collision here means the code belongs to someone else.
  const sameCode = await pool.query<{ slug: string }>(
    `select distinct t.slug
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.year = $1 and t.slug <> $2 and te.source_url ~ ('/posting/' || $1::text || '/' || $3 || '/')`,
    [year, slug, code]
  );

  if (apply) {
    await pool.query(`update tournament_editions set source_url = $2, updated_at = now() where id = $1`, [
      edition.id,
      nextSourceUrl,
    ]);
  }

  return NextResponse.json({
    ok: true,
    apply,
    slug,
    year,
    startDate: edition.start_date,
    status: edition.status,
    code,
    previousSourceUrl: edition.source_url,
    sourceUrl: nextSourceUrl,
    sameSeasonCodeOnOtherSlugs: sameCode.rows.map((r) => r.slug),
    message: apply ? 'Code attached. Run /api/import-cutoffs?year=&slug= to pull its cuts.' : 'Dry run. Append &apply=true to write.',
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import slugify from 'slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_TO_EDITION = new Map(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [Number(e.edition.protennislive_code), e])
);

type AtpTournamentRef = {
  code: number;
  citySlug: string;
};

// ─── ATP Tour scraping ────────────────────────────────────────────────────────────────────────────────────
//
// ATP Tour tournament URLs follow this pattern:
//   /en/scores/archive/{city-slug}/{numeric-id}/{year}/draws
//   /en/scores/archive/{city-slug}/{numeric-id}/{year}/results
//
// The {numeric-id} is permanent and identical to the ProTennisLive
// posting code used in https://www.protennislive.com/posting/{year}/{id}/mds.pdf
//
// This function fetches the results-archive page and extracts all IDs
// from any occurrence of that URL pattern in the HTML.

async function discoverIdsFromAtpPage(url: string): Promise<AtpTournamentRef[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`ATP Tour returned ${res.status} for ${url}`);

  const html = await res.text();

  // Method 1: URL pattern in href / data-href / src / JSON strings
  // Matches: /scores/archive/some-city/1234/2026/ (or /2025/, /2024/, etc.)
  const urlPattern = /\/scores\/archive\/([a-z0-9-]+)\/(\d{2,6})\/\d{4}\//gi;
  const seen = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = urlPattern.exec(html)) !== null) {
    const code = Number(m[2]);
    if (code > 0 && !seen.has(code)) seen.set(code, m[1]);
  }

  // Method 2: __NEXT_DATA__ JSON blob (Next.js SSR apps)
  if (seen.size === 0) {
    const ndm = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ndm) {
      try {
        const nd = JSON.parse(ndm[1]) as Record<string, unknown>;
        extractIdsFromObject(nd, seen);
      } catch {
        // ignore
      }
    }
  }

  return Array.from(seen.entries()).map(([code, citySlug]) => ({ code, citySlug }));
}

function extractIdsFromObject(obj: unknown, out: Map<number, string>): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) extractIdsFromObject(item, out);
    return;
  }
  const rec = obj as Record<string, unknown>;
  for (const [key, val] of Object.entries(rec)) {
    if (
      typeof val === 'string' &&
      /scores\/archive\/([a-z0-9-]+)\/(\d{2,6})\/\d{4}\//.test(val)
    ) {
      const match = val.match(/\/scores\/archive\/([a-z0-9-]+)\/(\d{2,6})\/\d{4}\//);
      if (match) {
        const code = Number(match[2]);
        if (code > 0 && !out.has(code)) out.set(code, match[1]);
      }
    }
    if (
      (key === 'tournamentId' || key === 'tournament_id' || key === 'atpId') &&
      typeof val === 'string'
    ) {
      const code = Number(val);
      if (code > 0 && !out.has(code)) out.set(code, 'unknown');
    }
    extractIdsFromObject(val, out);
  }
}

// ─── DB helpers ────────────────────────────────────────────────────────────────────────────────

async function ensureTournamentRow(
  slug: string,
  name: string,
  city: string,
  country: string | null
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set updated_at = now()
     returning id`,
    [slug, name, city, country]
  );
  return r.rows[0].id;
}

async function ensureEditionRow(
  tournamentId: string,
  year: number,
  week: number | null,
  startDate: string | null,
  level: string,
  surface: string,
  source: string
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, level, surface,
       indoor, source, status, updated_at
     ) values ($1, $2, $3, $4, $5, $6, false, $7, 'held', now())
     on conflict (tournament_id, year) do update set
       updated_at = now()
     returning id`,
    [tournamentId, year, week, startDate, level, surface, source]
  );
  return r.rows[0].id;
}

async function tryImportCut(
  editionId: string,
  code: number,
  year: number,
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying',
  pdfNames: string[]
): Promise<{ ok: boolean; rank?: number | null }> {
  const base = `https://www.protennislive.com/posting/${year}/${code}`;
  for (const pdf of pdfNames) {
    try {
      const parsed = await fetchAndParseOfficialPdfCutoff(`${base}/${pdf}`);
      await pool.query(
        `insert into cutoff_snapshots (
           tournament_edition_id, event_type, draw_type, source_type,
           last_direct_acceptance_rank, last_direct_acceptance_player_name,
           last_alternate_rank, last_alternate_player_name,
           challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
           challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
           parsed_at, parser_version, source_notes, alternate_entries_count, updated_at
         ) values (
           $1, $2, $3, 'official_pdf',
           $4, $5,
           null, null,
           $6, null, $7, null,
           now(), 'official-pdf-bottom-left-v4',
           $8, $9, now()
         )
         on conflict (tournament_edition_id, event_type, draw_type) do update set
           last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
           last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
           challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
           challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
           parsed_at = excluded.parsed_at,
           source_notes = excluded.source_notes,
           alternate_entries_count = excluded.alternate_entries_count,
           updated_at = now()`,
        [
          editionId, eventType, drawType,
          parsed.last_direct_acceptance_rank,
          parsed.last_direct_acceptance_name,
          parsed.challenger_doubles_advanced_cut_rank,
          parsed.challenger_doubles_onsite_cut_rank,
          `Official PDF: ${base}/${pdf}`,
          parsed.alternate_entries_count,
        ]
      );
      return { ok: true, rank: parsed.last_direct_acceptance_rank };
    } catch {
      // try next name
    }
  }
  return { ok: false };
}

// ─── Handler ────────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  if (isNaN(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }

  const type = params.get('type') ?? 'ch';
  const limit = Math.min(Number(params.get('limit') ?? '100'), 250);
  const offset = Number(params.get('offset') ?? '0');
  const importCuts = params.get('importCuts') !== 'false';

  const urls: string[] = [];
  if (type === 'ch' || type === 'all') {
    urls.push(`https://www.atptour.com/en/scores/results-archive?year=${year}&tournamentType=ch`);
  }
  if (type === 'atp' || type === 'all') {
    urls.push(`https://www.atptour.com/en/scores/results-archive?year=${year}&tournamentType=atp`);
  }

  const allRefs = new Map<number, string>();
  const scrapeErrors: string[] = [];

  for (const url of urls) {
    try {
      const refs = await discoverIdsFromAtpPage(url);
      for (const ref of refs) allRefs.set(ref.code, ref.citySlug);
    } catch (err) {
      scrapeErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (allRefs.size === 0) {
    return NextResponse.json({
      ok: false,
      error:
        'Could not extract any tournament IDs from ATP Tour pages. The page may be client-rendered (JavaScript required). Try the JeffSackmann fallback: /api/import-challenger-season?year=' + year,
      scrapeErrors,
      urls,
    }, { status: 502 });
  }

  const allCodes = Array.from(allRefs.entries()).slice(offset, offset + limit);
  const imported = [];
  const skipped = [];
  const failed = [];

  for (const [code, citySlug] of allCodes) {
    try {
      const editionEntry = CODE_TO_EDITION.get(code);

      let slug: string;
      let name: string;
      let city: string;
      let country: string | null;
      let level: string;
      let startDate: string | null;
      let week: number | null;
      let surface: string;

      if (editionEntry) {
        slug = editionEntry.tournament.slug;
        name = editionEntry.tournament.name;
        city = editionEntry.tournament.city;
        country = editionEntry.tournament.country;
        level = editionEntry.edition.level;
        startDate = editionEntry.edition.start_date;
        week = editionEntry.edition.week;
        surface = editionEntry.edition.surface;
      } else {
        city = citySlug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        name = city;
        country = null;
        level = type === 'ch' ? 'Challenger' : 'ATP 250';
        surface = 'Hard';
        startDate = null;
        week = null;
        slug = slugify(`${name}-${city}`, { lower: true, strict: true, trim: true });
      }

      const tournamentId = await ensureTournamentRow(slug, name, city, country);
      const editionId = await ensureEditionRow(
        tournamentId, year, week, startDate, level, surface,
        type === 'ch' ? 'atp_challenger_pdf' : 'atp_tour_pdf'
      );

      let cutsResult: { singles_main: unknown; singles_qual: unknown; doubles_main: unknown } | null = null;

      if (importCuts) {
        const [singlesMain, singlesQual, doublesMain] = await Promise.all([
          tryImportCut(editionId, code, year, 'singles', 'main', ['mds.pdf', 'mds-1.pdf', 'md.pdf']),
          tryImportCut(editionId, code, year, 'singles', 'qualifying', ['qs.pdf', 'q.pdf']),
          tryImportCut(editionId, code, year, 'doubles', 'main', ['mdd.pdf', 'mdd-1.pdf', 'md.pdf']),
        ]);
        cutsResult = {
          singles_main: singlesMain.ok ? singlesMain.rank : 'no_pdf',
          singles_qual: singlesQual.ok ? singlesQual.rank : 'no_pdf',
          doubles_main: doublesMain.ok ? doublesMain.rank : 'no_pdf',
        };
        const anyPdf = singlesMain.ok || singlesQual.ok || doublesMain.ok;
        const entry = { slug, name, year, code, citySlug, inOurCalendar: Boolean(editionEntry), ...cutsResult };
        if (anyPdf) imported.push(entry);
        else skipped.push(entry);
      } else {
        imported.push({ slug, name, year, code, citySlug, inOurCalendar: Boolean(editionEntry) });
      }
    } catch (err) {
      failed.push({ code, citySlug, year, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    year,
    type,
    discoveredCount: allRefs.size,
    offset,
    limit,
    pageSize: allCodes.length,
    hasMore: offset + limit < allRefs.size,
    nextOffset: offset + limit < allRefs.size ? offset + limit : null,
    importedCount: imported.length,
    skippedNoPdfCount: skipped.length,
    failedCount: failed.length,
    scrapeErrors,
    imported,
    skipped,
    failed,
  });
}

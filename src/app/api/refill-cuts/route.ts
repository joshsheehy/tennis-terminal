import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Aggressively retries the cut import for editions with missing cut snapshots.
// Tries an expanded set of PDF file names AND multiple ProTennisLive year folders
// (the calendar year of start_date, the prior calendar year, and te.year).
//
// Use ?year=2024|2025|2026 to scope the run. ?limit=N caps how many editions to attempt.
// ?dryRun=true reports which editions would be tried without fetching.

const SLUG_TO_CODE = new Map<string, string>(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [e.tournament.slug, String(e.edition.protennislive_code)])
);

const SLUG_HAS_DOUBLES_QUAL_REFILL = new Set(
  ALL_EDITIONS.filter((e) => e.edition.has_doubles_qualifying).map((e) => e.tournament.slug)
);
const ALL_KNOWN_SLUGS_REFILL = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

const PDF_PATTERNS = {
  singles_main: ['mds.pdf', 'mds-1.pdf', 'mds-2.pdf', 'mds-3.pdf', 'md.pdf', 'ms.pdf', 'ad.pdf', 'mds-final.pdf'],
  singles_qual: ['qs.pdf', 'qs-1.pdf', 'qs-2.pdf', 'q.pdf', 'qd.pdf', 'qsa.pdf', 'qs-final.pdf'],
  doubles_main: ['mdd.pdf', 'mdd-1.pdf', 'mdd-2.pdf', 'mdd-3.pdf', 'md.pdf', 'dd.pdf', 'mdd-final.pdf'],
  doubles_qual: ['qd.pdf', 'qd-1.pdf', 'qdd.pdf'],
};

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  year: number;
  start_date: string;
  level: string;
  has_singles_main: boolean;
  has_singles_qual: boolean;
  has_doubles_main: boolean;
  has_doubles_qual: boolean;
  existing_source_notes: string[];
};

function extractCodeFromSourceNotes(notes: string[]): string | null {
  for (const note of notes) {
    const m = note.match(/\/posting\/\d+\/(\d+)\//);
    if (m) return m[1];
  }
  return null;
}

async function tryCut(
  editionId: string,
  code: string,
  candidateYears: number[],
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying',
  pdfNames: string[]
): Promise<{ ok: boolean; pdfUrl?: string; rank?: number | null }> {
  for (const year of candidateYears) {
    const baseUrl = `https://www.protennislive.com/posting/${year}/${code}`;
    for (const pdfName of pdfNames) {
      const pdfUrl = `${baseUrl}/${pdfName}`;
      try {
        const parsed = await fetchAndParseOfficialPdfCutoff(pdfUrl);
        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
           ) values (
             $1, $2, $3, 'official_pdf',
             $4, $5,
             null, null,
             $6, null, $7, null,
             now(), 'official-pdf-bottom-left-v4',
             $8, $9, $10, now()
           )
           on conflict (tournament_edition_id, event_type, draw_type) do update set
             last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
             last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
             challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
             challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
             parsed_at = excluded.parsed_at,
             source_notes = excluded.source_notes,
             alternate_entries_count = excluded.alternate_entries_count,
             lucky_loser_count = excluded.lucky_loser_count,
             updated_at = now()`,
          [
            editionId, eventType, drawType,
            parsed.last_direct_acceptance_rank,
            parsed.last_direct_acceptance_name,
            parsed.challenger_doubles_advanced_cut_rank,
            parsed.challenger_doubles_onsite_cut_rank,
            `Official PDF: ${pdfUrl}`,
            parsed.alternate_entries_count,
            parsed.lucky_loser_count,
          ]
        );
        return { ok: true, pdfUrl, rank: parsed.last_direct_acceptance_rank };
      } catch {
        // continue to next pattern
      }
    }
  }
  return { ok: false };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : null;
  const limit = Math.min(Number(params.get('limit') ?? '50'), 200);
  const dryRun = params.get('dryRun') === 'true';

  const queryParams: unknown[] = [];
  let yearFilter = '';
  if (year && [2024, 2025, 2026].includes(year)) {
    queryParams.push(year);
    yearFilter = `and te.year = $1`;
  }

  const editionsResult = await pool.query<EditionRow>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      te.year,
      te.start_date::text as start_date,
      te.level,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qual,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
      exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qual,
      coalesce(array_agg(cs.source_notes) filter (where cs.source_notes is not null), array[]::text[]) as existing_source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.status = 'held'
      and te.start_date is not null
      and te.year >= 2024
      ${yearFilter}
    group by te.id, t.slug, t.name, te.year, te.start_date, te.level
    order by te.year, te.start_date, t.name
    `,
    queryParams
  );

  // Filter to those missing something
  const incomplete = editionsResult.rows.filter((r) => {
    const isChallenger = r.level.toLowerCase().includes('challenger');
    const needsDoublesQual = !isChallenger && (
      SLUG_HAS_DOUBLES_QUAL_REFILL.has(r.slug) ||
      (!ALL_KNOWN_SLUGS_REFILL.has(r.slug) && (r.level.includes('500') || r.level.includes('1000')))
    );
    return !r.has_singles_main || !r.has_singles_qual || !r.has_doubles_main || (needsDoublesQual && !r.has_doubles_qual);
  });

  const work = incomplete.slice(0, limit);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      year,
      totalIncomplete: incomplete.length,
      wouldAttempt: work.length,
      editions: work.map((r) => ({
        slug: r.slug,
        name: r.name,
        year: r.year,
        start_date: r.start_date,
        codeFromSlug: SLUG_TO_CODE.get(r.slug) ?? null,
        codeFromNotes: extractCodeFromSourceNotes(r.existing_source_notes),
      })),
    });
  }

  const filled: Array<{ slug: string; year: number; filled: string[] }> = [];
  const stillMissing: Array<{ slug: string; year: number; missing: string[]; reason: string }> = [];

  for (const r of work) {
    const code = SLUG_TO_CODE.get(r.slug) ?? extractCodeFromSourceNotes(r.existing_source_notes);
    if (!code) {
      stillMissing.push({ slug: r.slug, year: r.year, missing: ['all'], reason: 'no protennislive code available' });
      continue;
    }

    // ProTennisLive uses calendar year. For Dec-30-start tournaments belonging to next ATP year,
    // PDFs are in the prior calendar year folder. Also try +1 in case data was posted late.
    const startCalendarYear = Number(r.start_date.slice(0, 4));
    const candidateYears = Array.from(new Set([startCalendarYear, startCalendarYear - 1, startCalendarYear + 1, r.year, r.year - 1]));

    const isChallenger = r.level.toLowerCase().includes('challenger');
    const needsDoublesQualFill = !isChallenger && (
      SLUG_HAS_DOUBLES_QUAL_REFILL.has(r.slug) ||
      (!ALL_KNOWN_SLUGS_REFILL.has(r.slug) && (r.level.includes('500') || r.level.includes('1000')))
    );
    const filledThis: string[] = [];

    if (!r.has_singles_main) {
      const res = await tryCut(r.edition_id, code, candidateYears, 'singles', 'main', PDF_PATTERNS.singles_main);
      if (res.ok) filledThis.push(`singles_main(rank=${res.rank})`);
    }
    if (!r.has_singles_qual) {
      const res = await tryCut(r.edition_id, code, candidateYears, 'singles', 'qualifying', PDF_PATTERNS.singles_qual);
      if (res.ok) filledThis.push(`singles_qual(rank=${res.rank})`);
    }
    if (!r.has_doubles_main) {
      const res = await tryCut(r.edition_id, code, candidateYears, 'doubles', 'main', PDF_PATTERNS.doubles_main);
      if (res.ok) filledThis.push(`doubles_main(rank=${res.rank})`);
    }
    if (needsDoublesQualFill && !r.has_doubles_qual) {
      const res = await tryCut(r.edition_id, code, candidateYears, 'doubles', 'qualifying', PDF_PATTERNS.doubles_qual);
      if (res.ok) filledThis.push(`doubles_qual(rank=${res.rank})`);
    }

    if (filledThis.length > 0) {
      filled.push({ slug: r.slug, year: r.year, filled: filledThis });
    } else {
      const stillMissingDraws: string[] = [];
      if (!r.has_singles_main) stillMissingDraws.push('singles_main');
      if (!r.has_singles_qual) stillMissingDraws.push('singles_qual');
      if (!r.has_doubles_main) stillMissingDraws.push('doubles_main');
      if (needsDoublesQualFill && !r.has_doubles_qual) stillMissingDraws.push('doubles_qual');
      stillMissing.push({
        slug: r.slug,
        year: r.year,
        missing: stillMissingDraws,
        reason: `no PDF found at ${candidateYears.join(',')} folders (code ${code})`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    year,
    totalIncomplete: incomplete.length,
    attempted: work.length,
    filledCount: filled.length,
    stillMissingCount: stillMissing.length,
    filled,
    stillMissing,
    hasMore: incomplete.length > limit,
  });
}

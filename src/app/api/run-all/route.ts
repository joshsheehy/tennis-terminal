import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_BUDGET_MS = 22000;

const SLUG_TO_CODE = new Map<string, string>(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [e.tournament.slug, String(e.edition.protennislive_code)])
);

const SLUG_HAS_DOUBLES_QUAL = new Set(
  ALL_EDITIONS.filter((e) => e.edition.has_doubles_qualifying).map((e) => e.tournament.slug)
);
const ALL_KNOWN_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

const PDF_PATTERNS = {
  singles_main: ['mds.pdf', 'mds-1.pdf', 'mds-2.pdf', 'mds-3.pdf', 'md.pdf', 'ms.pdf', 'ad.pdf', 'mds-final.pdf'],
  singles_qual: ['qs.pdf', 'qs-1.pdf', 'qs-2.pdf', 'q.pdf', 'qd.pdf', 'qsa.pdf', 'qs-final.pdf'],
  doubles_main: ['mdd.pdf', 'mdd-1.pdf', 'mdd-2.pdf', 'mdd-3.pdf', 'md.pdf', 'dd.pdf', 'mdd-final.pdf'],
  doubles_qual: ['qd.pdf', 'qd-1.pdf', 'qdd.pdf'],
};

type DrawKey = keyof typeof PDF_PATTERNS;

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  year: number;
  start_date: string;
  level: string;
  source_url: string | null;
  has_singles_main: boolean;
  has_singles_qual: boolean;
  has_doubles_main: boolean;
  has_doubles_qual: boolean;
  existing_source_notes: string[];
  tried_singles_main: boolean;
  tried_singles_qual: boolean;
  tried_doubles_main: boolean;
  tried_doubles_qual: boolean;
};

function extractCodeFromTextSources(sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const match = source.match(/\/posting\/\d+\/(\d+)\//);
    if (match) return match[1];
  }
  return null;
}

function needsDoublesQual(row: { level: string; slug: string }) {
  const isChallenger = row.level.toLowerCase().includes('challenger');
  const isAtp500 = row.level.includes('500') && !row.level.includes('1000');
  return !isChallenger && (SLUG_HAS_DOUBLES_QUAL.has(row.slug) || (!ALL_KNOWN_SLUGS.has(row.slug) && isAtp500));
}

async function markNotFound(editionId: string, eventType: 'singles' | 'doubles', drawType: 'main' | 'qualifying', note: string) {
  await pool.query(
    `insert into cutoff_snapshots (
      tournament_edition_id, event_type, draw_type, source_type, source_notes,
      parsed_at, parser_version, updated_at
    ) values ($1, $2, $3, 'official_pdf_not_found', $4, now(), 'official-pdf-bottom-left-v4', now())
    on conflict (tournament_edition_id, event_type, draw_type) do update set
      source_type = 'official_pdf_not_found', source_notes = excluded.source_notes,
      parsed_at = excluded.parsed_at, parser_version = excluded.parser_version,
      updated_at = now()
    where cutoff_snapshots.last_direct_acceptance_rank is null
      and cutoff_snapshots.challenger_doubles_advanced_cut_rank is null
      and cutoff_snapshots.challenger_doubles_onsite_cut_rank is null`,
    [editionId, eventType, drawType, note]
  );
}

async function tryFill(
  editionId: string,
  code: string,
  candidateYears: number[],
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying',
  pdfNames: string[]
): Promise<boolean> {
  for (const year of candidateYears) {
    const baseUrl = `https://www.protennislive.com/posting/${year}/${code}`;
    for (const pdfName of pdfNames) {
      const pdfUrl = `${baseUrl}/${pdfName}`;
      try {
        const parsed = await fetchAndParseOfficialPdfCutoff(pdfUrl);
        const hasRealCut = parsed.last_direct_acceptance_rank != null || parsed.challenger_doubles_advanced_cut_rank != null || parsed.challenger_doubles_onsite_cut_rank != null;
        if (!hasRealCut) continue;

        await pool.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
           ) values (
             $1, $2, $3, 'official_pdf', $4, $5, null, null, $6, null, $7, null,
             now(), 'official-pdf-bottom-left-v4', $8, $9, $10, now()
           )
           on conflict (tournament_edition_id, event_type, draw_type) do update set
             source_type = 'official_pdf',
             last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
             last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
             challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
             challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
             parsed_at = excluded.parsed_at, source_notes = excluded.source_notes,
             alternate_entries_count = excluded.alternate_entries_count,
             lucky_loser_count = excluded.lucky_loser_count, updated_at = now()`,
          [
            editionId, eventType, drawType,
            parsed.last_direct_acceptance_rank, parsed.last_direct_acceptance_name,
            parsed.challenger_doubles_advanced_cut_rank, parsed.challenger_doubles_onsite_cut_rank,
            `Official PDF: ${pdfUrl}`,
            parsed.alternate_entries_count, parsed.lucky_loser_count,
          ]
        );
        return true;
      } catch {
      }
    }
  }

  await markNotFound(editionId, eventType, drawType, `Official PDF not found/unposted for code ${code}`);
  return false;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const retryNotFound = request.nextUrl.searchParams.get('retryNotFound') === 'true';
  const includeFuture = request.nextUrl.searchParams.get('includeFuture') === 'true';

  const namesResult = await pool.query(
    `update tournaments
     set name = trim(regexp_replace(name, '\\s+[Cc][Hh](\\s+\\d+)?$', '')),
         city = trim(regexp_replace(city, '\\s+[Cc][Hh](\\s+\\d+)?$', ''))
     where name ~* '\\s+ch(\\s+\\d+)?$' or city ~* '\\s+ch(\\s+\\d+)?$'`
  );

  await Promise.all([2024, 2025, 2026].map((year) =>
    pool.query(
      `update tournament_editions te
       set week = greatest(1, (te.start_date::date - date_trunc('week', make_date(te.year, 1, 1))::date) / 7 + 1)
       where te.year = $1 and te.start_date is not null
         and not (extract(month from te.start_date) = 12 and extract(year from te.start_date) = te.year)`, [year]
    )));

  const editionsResult = await pool.query<EditionRow>(
    `select te.id as edition_id, t.slug, t.name, te.year, te.start_date::text as start_date, te.level, te.source_url,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.source_type = 'official_pdf_not_found') as tried_singles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.source_type = 'official_pdf_not_found') as tried_singles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and cs.source_type = 'official_pdf_not_found') as tried_doubles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.source_type = 'official_pdf_not_found') as tried_doubles_qual,
       coalesce(array_agg(cs.source_notes) filter (where cs.source_notes is not null), array[]::text[]) as existing_source_notes
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
     where te.status = 'held' and te.start_date is not null and te.year >= 2024
     group by te.id, t.slug, t.name, te.year, te.start_date, te.level, te.source_url
     order by te.year, te.start_date, t.name`
  );

  const today = new Date().toISOString().slice(0, 10);
  const incomplete = editionsResult.rows.filter((r) => {
    const future = r.start_date > today;
    if (future && !includeFuture) return false;
    const dQual = needsDoublesQual(r);
    return !r.has_singles_main || !r.has_singles_qual || !r.has_doubles_main || (dQual && !r.has_doubles_qual);
  });

  let filled = 0, noCode = 0, processed = 0, timedOut = false, skippedNotFound = 0;

  for (const r of incomplete) {
    if (Date.now() - startTime > TIME_BUDGET_MS) { timedOut = true; break; }
    processed++;
    const code = SLUG_TO_CODE.get(r.slug) ?? extractCodeFromTextSources([r.source_url, ...r.existing_source_notes]);
    if (!code) { noCode++; continue; }

    const startCalendarYear = Number(r.start_date.slice(0, 4));
    const candidateYears = Array.from(new Set([startCalendarYear, startCalendarYear - 1, startCalendarYear + 1, r.year, r.year - 1]));

    const tasks: Promise<boolean>[] = [];
    if (!r.has_singles_main && (retryNotFound || !r.tried_singles_main)) tasks.push(tryFill(r.edition_id, code, candidateYears, 'singles', 'main', PDF_PATTERNS.singles_main)); else if (!r.has_singles_main) skippedNotFound++;
    if (!r.has_singles_qual && (retryNotFound || !r.tried_singles_qual)) tasks.push(tryFill(r.edition_id, code, candidateYears, 'singles', 'qualifying', PDF_PATTERNS.singles_qual)); else if (!r.has_singles_qual) skippedNotFound++;
    if (!r.has_doubles_main && (retryNotFound || !r.tried_doubles_main)) tasks.push(tryFill(r.edition_id, code, candidateYears, 'doubles', 'main', PDF_PATTERNS.doubles_main)); else if (!r.has_doubles_main) skippedNotFound++;
    if (needsDoublesQual(r) && !r.has_doubles_qual && (retryNotFound || !r.tried_doubles_qual)) tasks.push(tryFill(r.edition_id, code, candidateYears, 'doubles', 'qualifying', PDF_PATTERNS.doubles_qual)); else if (needsDoublesQual(r) && !r.has_doubles_qual) skippedNotFound++;

    if (tasks.length === 0) continue;
    const results = await Promise.all(tasks);
    if (results.some(Boolean)) filled++;
  }

  const processableRemaining = incomplete.length - processed;
  const hasMore = timedOut && processableRemaining > 0;

  return NextResponse.json({ ok: true, namesFixed: namesResult.rowCount ?? 0, totalIncomplete: incomplete.length, processedThisCall: processed, filled, noCode, skippedNotFound, remaining: processableRemaining, retryNotFound, includeFuture, hasMore });
}

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventType = 'singles' | 'doubles';
type DrawType = 'main' | 'qualifying';

type PdfImportTarget = {
  slug: string;
  year: number;
  event_type: EventType;
  draw_type: DrawType;
  pdf_url: string;
};

type OfficialPdfSource = {
  slug: string;
  year: number;
  code: string;
};

const currentTournamentCodes = [
  { slug: 'brisbane-international-presented-by-anz-brisbane', code: '339' },
  { slug: 'bank-of-china-hong-kong-tennis-open-hong-kong', code: '336' },
  { slug: 'adelaide-international-adelaide', code: '8998' },
  { slug: 'asb-classic-auckland', code: '301' },
  { slug: 'open-occitanie-montpellier', code: '375' },
  { slug: 'dallas-open-dallas', code: '424' },
  { slug: 'abn-amro-open-rotterdam', code: '407' },
  { slug: 'ieb-argentina-open-buenos-aires', code: '506' },
  { slug: 'qatar-exxonmobil-open-doha', code: '451' },
  { slug: 'rio-open-presented-by-claro-rio-de-janeiro', code: '6932' },

  { slug: 'bnp-paribas-open-indian-wells', code: '404' },
  { slug: 'miami-open-presented-by-itau-miami', code: '403' },
  { slug: 'rolex-monte-carlo-masters-monte-carlo', code: '410' },
  { slug: 'mutua-madrid-open-madrid', code: '1536' },
  { slug: 'internazionali-bnl-ditalia-rome', code: '416' },
  { slug: 'national-bank-open-presented-by-rogers-montreal', code: '421' },
  { slug: 'cincinnati-open-cincinnati', code: '422' },
  { slug: 'rolex-shanghai-masters-shanghai', code: '5014' },
  { slug: 'rolex-paris-masters-paris', code: '352' },

  { slug: 'bengaluru-1-bengaluru', code: '7808' },
  { slug: 'canberra-canberra', code: '7393' },
  { slug: 'noumea-noumea', code: '2205' },
  { slug: 'nonthaburi-1-nonthaburi', code: '2791' },
  { slug: 'nottingham-1-nottingham', code: '2907' },
  { slug: 'nonthaburi-2-nonthaburi', code: '2795' },
  { slug: 'buenos-aires-challenger-buenos-aires', code: '1210' },
  { slug: 'glasgow-glasgow', code: '7916' },
  { slug: 'oeiras-1-oeiras', code: '2831' },
  { slug: 'itajai-itajai', code: '3053' },
];

function getRequestedYear(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : 2026;

  if (![2024, 2025, 2026].includes(year)) {
    throw new Error('year must be 2024, 2025, or 2026');
  }

  return year;
}

function buildOfficialPdfSources(year: number): OfficialPdfSource[] {
  return currentTournamentCodes.map((source) => ({
    slug: source.slug,
    year,
    code: source.code,
  }));
}

function buildPdfImportTargets(sources: OfficialPdfSource[]): PdfImportTarget[] {
  return sources.flatMap((source) => [
    {
      slug: source.slug,
      year: source.year,
      event_type: 'singles' as const,
      draw_type: 'main' as const,
      pdf_url: `https://www.protennislive.com/posting/${source.year}/${source.code}/mds.pdf`,
    },
    {
      slug: source.slug,
      year: source.year,
      event_type: 'singles' as const,
      draw_type: 'qualifying' as const,
      pdf_url: `https://www.protennislive.com/posting/${source.year}/${source.code}/qs.pdf`,
    },
    {
      slug: source.slug,
      year: source.year,
      event_type: 'doubles' as const,
      draw_type: 'main' as const,
      pdf_url: `https://www.protennislive.com/posting/${source.year}/${source.code}/mdd.pdf`,
    },
  ]);
}

async function getEditionId(slug: string, year: number) {
  const result = await pool.query<{ id: string }>(
    `
    select te.id
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
      and te.year = $2
    limit 1
    `,
    [slug, year]
  );

  return result.rows[0]?.id ?? null;
}

async function upsertCutoffSnapshot(
  target: PdfImportTarget,
  editionId: string,
  parsed: Awaited<ReturnType<typeof fetchAndParseOfficialPdfCutoff>>
) {
  await pool.query(
    `
    insert into cutoff_snapshots (
      tournament_edition_id,
      event_type,
      draw_type,
      source_type,
      last_direct_acceptance_rank,
      last_direct_acceptance_player_name,
      last_alternate_rank,
      last_alternate_player_name,
      challenger_doubles_advanced_cut_rank,
      challenger_doubles_advanced_team_name,
      challenger_doubles_onsite_cut_rank,
      challenger_doubles_onsite_team_name,
      parsed_at,
      parser_version,
      source_notes,
      alternate_entries_count,
      updated_at
    )
    values (
      $1,
      $2,
      $3,
      'official_pdf',
      $4,
      $5,
      null,
      null,
      $6,
      null,
      $7,
      null,
      now(),
      'official-pdf-bottom-left-v3',
      $8,
      $9,
      now()
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
      updated_at = now()
    `,
    [
      editionId,
      target.event_type,
      target.draw_type,
      parsed.last_direct_acceptance_rank,
      parsed.last_direct_acceptance_name,
      parsed.challenger_doubles_advanced_cut_rank,
      parsed.challenger_doubles_onsite_cut_rank,
      `Official PDF: ${target.pdf_url}. Raw Last Direct Acceptance: ${parsed.raw_last_direct_acceptance ?? 'not found'}.`,
      parsed.alternate_entries_count,
    ]
  );
}

export async function GET(request: NextRequest) {
  const imported = [];
  const skipped = [];
  const failed = [];

  let requestedYear: number;

  try {
    requestedYear = getRequestedYear(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Invalid year' },
      { status: 400 }
    );
  }

  const officialPdfSources = buildOfficialPdfSources(requestedYear);
  const pdfImportTargets = buildPdfImportTargets(officialPdfSources);

  for (const target of pdfImportTargets) {
    try {
      const editionId = await getEditionId(target.slug, target.year);

      if (!editionId) {
        skipped.push({ target, reason: 'Tournament edition not found. Run calendar import first.' });
        continue;
      }

      const parsed = await fetchAndParseOfficialPdfCutoff(target.pdf_url);

      await upsertCutoffSnapshot(target, editionId, parsed);

      imported.push({
        slug: target.slug,
        year: target.year,
        event_type: target.event_type,
        draw_type: target.draw_type,
        pdf_url: target.pdf_url,
        last_direct_acceptance_rank: parsed.last_direct_acceptance_rank,
        last_direct_acceptance_name: parsed.last_direct_acceptance_name,
        challenger_doubles_advanced_cut_rank: parsed.challenger_doubles_advanced_cut_rank,
        challenger_doubles_onsite_cut_rank: parsed.challenger_doubles_onsite_cut_rank,
        alternate_entries_count: parsed.alternate_entries_count,
      });
    } catch (error) {
      failed.push({
        target,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    year: requestedYear,
    sourceCount: officialPdfSources.length,
    targetCount: pdfImportTargets.length,
    importedCount: imported.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    imported,
    skipped,
    failed,
  });
}

import { NextResponse } from 'next/server';
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

const officialPdfSources: OfficialPdfSource[] = [
  // ATP Tour events currently seeded in the app.
  { slug: 'brisbane-international-presented-by-anz-brisbane', year: 2026, code: '339' },
  { slug: 'bank-of-china-hong-kong-tennis-open-hong-kong', year: 2026, code: '336' },
  { slug: 'adelaide-international-adelaide', year: 2026, code: '8998' },
  { slug: 'asb-classic-auckland', year: 2026, code: '301' },
  { slug: 'open-occitanie-montpellier', year: 2026, code: '375' },
  { slug: 'dallas-open-dallas', year: 2026, code: '424' },
  { slug: 'abn-amro-open-rotterdam', year: 2026, code: '407' },
  { slug: 'ieb-argentina-open-buenos-aires', year: 2026, code: '506' },
  { slug: 'qatar-exxonmobil-open-doha', year: 2026, code: '451' },
  { slug: 'rio-open-presented-by-claro-rio-de-janeiro', year: 2026, code: '6932' },

  // Challenger events currently seeded in the app.
  { slug: 'bengaluru-1-bengaluru', year: 2026, code: '7808' },
  { slug: 'canberra-canberra', year: 2026, code: '7393' },
  { slug: 'noumea-noumea', year: 2026, code: '2205' },
  { slug: 'nonthaburi-1-nonthaburi', year: 2026, code: '2791' },
  { slug: 'nottingham-1-nottingham', year: 2026, code: '2907' },
  { slug: 'nonthaburi-2-nonthaburi', year: 2026, code: '2795' },
  { slug: 'buenos-aires-challenger-buenos-aires', year: 2026, code: '1210' },
  { slug: 'glasgow-glasgow', year: 2026, code: '7916' },
  { slug: 'oeiras-1-oeiras', year: 2026, code: '2831' },
  { slug: 'itajai-itajai', year: 2026, code: '3053' },
];

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

const pdfImportTargets = buildPdfImportTargets(officialPdfSources);

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
      null,
      null,
      null,
      null,
      now(),
      'official-pdf-bottom-left-v2',
      $6,
      $7,
      now()
    )
    on conflict (tournament_edition_id, event_type, draw_type)
    do update set
      source_type = excluded.source_type,
      last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
      last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
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
      `Official PDF: ${target.pdf_url}. Raw Last Direct Acceptance: ${parsed.raw_last_direct_acceptance ?? 'not found'}.`,
      parsed.alternate_entries_count,
    ]
  );
}

export async function GET() {
  const imported = [];
  const skipped = [];
  const failed = [];

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
    ok: failed.length === 0,
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

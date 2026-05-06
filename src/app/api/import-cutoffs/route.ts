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

const pdfImportTargets: PdfImportTarget[] = [
  // ATP Tour week 1
  { slug: 'brisbane-international-presented-by-anz-brisbane', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/339/mds.pdf' },
  { slug: 'brisbane-international-presented-by-anz-brisbane', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/339/qs.pdf' },
  { slug: 'brisbane-international-presented-by-anz-brisbane', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/339/mdd.pdf' },

  { slug: 'bank-of-china-hong-kong-tennis-open-hong-kong', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/336/mds.pdf' },
  { slug: 'bank-of-china-hong-kong-tennis-open-hong-kong', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/336/qs.pdf' },
  { slug: 'bank-of-china-hong-kong-tennis-open-hong-kong', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/336/mdd.pdf' },

  // ATP Tour week 2
  { slug: 'adelaide-international-adelaide', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/8998/mds.pdf' },
  { slug: 'adelaide-international-adelaide', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/8998/qs.pdf' },
  { slug: 'adelaide-international-adelaide', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/8998/mdd.pdf' },

  { slug: 'asb-classic-auckland', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/301/mds.pdf' },
  { slug: 'asb-classic-auckland', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/301/qs.pdf' },
  { slug: 'asb-classic-auckland', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/301/mdd.pdf' },

  // ATP Tour week 5+
  { slug: 'open-occitanie-montpellier', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/375/mds.pdf' },
  { slug: 'open-occitanie-montpellier', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/375/qs.pdf' },
  { slug: 'open-occitanie-montpellier', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/375/mdd.pdf' },

  { slug: 'dallas-open-dallas', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/424/mds.pdf' },
  { slug: 'dallas-open-dallas', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/424/qs.pdf' },
  { slug: 'dallas-open-dallas', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/424/mdd.pdf' },

  { slug: 'abn-amro-open-rotterdam', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/407/mds.pdf' },
  { slug: 'abn-amro-open-rotterdam', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/407/qs.pdf' },
  { slug: 'abn-amro-open-rotterdam', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/407/mdd.pdf' },

  { slug: 'ieb-argentina-open-buenos-aires', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/506/mds.pdf' },
  { slug: 'ieb-argentina-open-buenos-aires', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/506/qs.pdf' },
  { slug: 'ieb-argentina-open-buenos-aires', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/506/mdd.pdf' },

  { slug: 'qatar-exxonmobil-open-doha', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/451/mds.pdf' },
  { slug: 'qatar-exxonmobil-open-doha', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/451/qs.pdf' },
  { slug: 'qatar-exxonmobil-open-doha', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/451/mdd.pdf' },

  { slug: 'rio-open-presented-by-claro-rio-de-janeiro', year: 2026, event_type: 'singles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/6932/mds.pdf' },
  { slug: 'rio-open-presented-by-claro-rio-de-janeiro', year: 2026, event_type: 'singles', draw_type: 'qualifying', pdf_url: 'https://www.protennislive.com/posting/2026/6932/qs.pdf' },
  { slug: 'rio-open-presented-by-claro-rio-de-janeiro', year: 2026, event_type: 'doubles', draw_type: 'main', pdf_url: 'https://www.protennislive.com/posting/2026/6932/mdd.pdf' },
];

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
      'official-pdf-bottom-left-v1',
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
    importedCount: imported.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    imported,
    skipped,
    failed,
  });
}

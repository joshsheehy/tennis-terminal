import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventType = 'singles' | 'doubles';
type DrawType = 'main' | 'qualifying';

type PdfImportTarget = {
  slug: string;
  year: number;
  event_type: EventType;
  draw_type: DrawType;
  pdf_url_candidates: string[];
};

type OfficialPdfSource = {
  slug: string;
  year: number;
  code: string;
  level: 'atp_250' | 'atp_500' | 'atp_1000' | 'challenger';
  has_doubles_qualifying: boolean;
};

type EditionTemplate = {
  tournament_id: string;
  week: number | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  level: string;
  surface: string;
  indoor: boolean | null;
  source: string;
  source_url: string | null;
};

async function getEditionSlugsForYear(year: number) {
  const result = await pool.query<{ slug: string; level: string }>(
    `
    select t.slug, te.level
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'held'
    `,
    [year]
  );

  return result.rows;
}

function normalizeLevel(level: string): OfficialPdfSource['level'] | null {
  if (level === 'ATP 250') return 'atp_250';
  if (level === 'ATP 500') return 'atp_500';
  if (level === 'ATP 1000') return 'atp_1000';
  if (level.startsWith('Challenger')) return 'challenger';
  return null;
}

function getRequestedYear(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : 2026;

  if (![2024, 2025, 2026].includes(year)) {
    throw new Error('year must be 2024, 2025, or 2026');
  }

  return year;
}

function shiftDateToYear(rawDate: string | Date | null, year: number) {
  if (!rawDate) return null;

  // pg returns PostgreSQL date columns as Date objects; handle both
  const iso = rawDate instanceof Date
    ? `${rawDate.getUTCFullYear()}-${String(rawDate.getUTCMonth() + 1).padStart(2, '0')}-${String(rawDate.getUTCDate()).padStart(2, '0')}`
    : String(rawDate);

  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const [, month, day] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const ATP_TOUR_LEVELS: OfficialPdfSource['level'][] = ['atp_250', 'atp_500', 'atp_1000'];

function buildOfficialPdfSources(year: number, atpOnly: boolean): OfficialPdfSource[] {
  return ALL_EDITIONS
    .filter((entry) => entry.edition.year === 2026 && entry.edition.protennislive_code)
    .map((entry) => ({
      slug: entry.tournament.slug,
      year,
      code: entry.edition.protennislive_code as string,
      level: normalizeLevel(entry.edition.level) as OfficialPdfSource['level'],
      has_doubles_qualifying: entry.edition.has_doubles_qualifying,
    }))
    .filter((entry) => Boolean(entry.level))
    .filter((entry) => !atpOnly || ATP_TOUR_LEVELS.includes(entry.level));
}

function buildPdfImportTargets(sources: OfficialPdfSource[]): PdfImportTarget[] {
  return sources.flatMap((source) => {
    const baseUrl = `https://www.protennislive.com/posting/${source.year}/${source.code}`;
    const targets: PdfImportTarget[] = [
      {
        slug: source.slug,
        year: source.year,
        event_type: 'singles',
        draw_type: 'main',
        pdf_url_candidates: [`${baseUrl}/mds.pdf`, `${baseUrl}/mds-1.pdf`, `${baseUrl}/mds-2.pdf`, `${baseUrl}/mds-3.pdf`, `${baseUrl}/md.pdf`, `${baseUrl}/ms.pdf`, `${baseUrl}/ad.pdf`, `${baseUrl}/mds-final.pdf`],
      },
      {
        slug: source.slug,
        year: source.year,
        event_type: 'singles',
        draw_type: 'qualifying',
        pdf_url_candidates: [`${baseUrl}/qs.pdf`, `${baseUrl}/qs-1.pdf`, `${baseUrl}/qs-2.pdf`, `${baseUrl}/q.pdf`, `${baseUrl}/qd.pdf`, `${baseUrl}/qsa.pdf`, `${baseUrl}/qs-final.pdf`],
      },
      {
        slug: source.slug,
        year: source.year,
        event_type: 'doubles',
        draw_type: 'main',
        pdf_url_candidates: [`${baseUrl}/mdd.pdf`, `${baseUrl}/mdd-1.pdf`, `${baseUrl}/mdd-2.pdf`, `${baseUrl}/mdd-3.pdf`, `${baseUrl}/md.pdf`, `${baseUrl}/dd.pdf`, `${baseUrl}/mdd-final.pdf`],
      },
    ];
    if (source.has_doubles_qualifying) {
      targets.push({ slug: source.slug, year: source.year, event_type: 'doubles', draw_type: 'qualifying', pdf_url_candidates: [`${baseUrl}/qd.pdf`, `${baseUrl}/qd-1.pdf`, `${baseUrl}/qdd.pdf`] });
    }
    return targets;
  });
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

async function getEditionTemplate(slug: string): Promise<EditionTemplate | null> {
  const result = await pool.query<EditionTemplate>(
    `
    select
      te.tournament_id,
      te.week,
      te.start_date,
      te.end_date,
      te.level,
      te.surface,
      te.indoor,
      te.source,
      te.source_url
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
      and te.status = 'held'
    order by te.year desc
    limit 1
    `,
    [slug]
  );

  return result.rows[0] ?? null;
}

async function createHistoricalEditionFromTemplate(slug: string, year: number) {
  const template = await getEditionTemplate(slug);

  if (!template) return null;

  const result = await pool.query<{ id: string }>(
    `
    insert into tournament_editions (
      tournament_id,
      year,
      week,
      start_date,
      end_date,
      level,
      surface,
      indoor,
      source,
      source_url,
      status,
      updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', now())
    on conflict (tournament_id, year)
    do update set
      updated_at = now()
    returning id
    `,
    [
      template.tournament_id,
      year,
      template.week,
      shiftDateToYear(template.start_date, year),
      shiftDateToYear(template.end_date, year),
      template.level,
      template.surface,
      template.indoor,
      template.source,
      template.source_url,
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function getOrCreateEditionId(slug: string, year: number) {
  const existingEditionId = await getEditionId(slug, year);
  if (existingEditionId) return existingEditionId;

  return createHistoricalEditionFromTemplate(slug, year);
}

async function upsertCutoffSnapshot(
  target: PdfImportTarget,
  editionId: string,
  parsed: Awaited<ReturnType<typeof fetchAndParseOfficialPdfCutoff>>,
  importedPdfUrl: string
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
      lucky_loser_count,
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
      'official-pdf-bottom-left-v4',
      $8,
      $9,
      $10,
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
      lucky_loser_count = excluded.lucky_loser_count,
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
      `Official PDF: ${importedPdfUrl}. Raw Last Direct Acceptance: ${parsed.raw_last_direct_acceptance ?? 'not found'}. Historical edition row may be generated from current calendar metadata when no exact historical calendar row exists yet.`,
      parsed.alternate_entries_count,
      parsed.lucky_loser_count,
    ]
  );
}

export async function GET(request: NextRequest) {
  const importedWithCuts = [];
  const importedNullCuts = [];
  const skippedNoPdf = [];
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

  const atpOnly = request.nextUrl.searchParams.get('atpOnly') === 'true';
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '50'), 200);
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');

  const editionSlugs = await getEditionSlugsForYear(requestedYear);
  const knownCodeBySlug = new Map(
    ALL_EDITIONS
      .filter((entry) => entry.edition.year === 2026 && entry.edition.protennislive_code)
      .map((entry) => [entry.tournament.slug, entry.edition.protennislive_code])
  );
  const missingCodeMappings = editionSlugs
    .filter((edition) => {
      const normalizedLevel = normalizeLevel(edition.level);
      if (!normalizedLevel) return false;
      if (atpOnly && !ATP_TOUR_LEVELS.includes(normalizedLevel)) return false;
      return !knownCodeBySlug.has(edition.slug);
    })
    .map((edition) => ({ slug: edition.slug, level: edition.level }));

  const officialPdfSources = buildOfficialPdfSources(requestedYear, atpOnly);
  const allTargets = buildPdfImportTargets(officialPdfSources);
  const pdfImportTargets = allTargets.slice(offset, offset + limit);

  for (const target of pdfImportTargets) {
    try {
      let parsed: Awaited<ReturnType<typeof fetchAndParseOfficialPdfCutoff>> | null = null;
      let importedPdfUrl: string | null = null;
      for (const pdfUrl of target.pdf_url_candidates) {
        try {
          parsed = await fetchAndParseOfficialPdfCutoff(pdfUrl);
          importedPdfUrl = pdfUrl;
          break;
        } catch {
          // try next candidate URL
        }
      }
      if (!parsed || !importedPdfUrl) {
        skippedNoPdf.push({
          target,
          reason: `No available PDF in: ${target.pdf_url_candidates.join(', ')}`,
        });
        continue;
      }
      const editionId = await getOrCreateEditionId(target.slug, target.year);

      if (!editionId) {
        failed.push({ target, error: 'Tournament row not found for slug.' });
        continue;
      }

      await upsertCutoffSnapshot(target, editionId, parsed, importedPdfUrl);

      const importedItem = {
        slug: target.slug,
        year: target.year,
        event_type: target.event_type,
        draw_type: target.draw_type,
        pdf_url: importedPdfUrl,
        last_direct_acceptance_rank: parsed.last_direct_acceptance_rank,
        last_direct_acceptance_name: parsed.last_direct_acceptance_name,
        raw_last_direct_acceptance: parsed.raw_last_direct_acceptance,
        challenger_doubles_advanced_cut_rank: parsed.challenger_doubles_advanced_cut_rank,
        challenger_doubles_onsite_cut_rank: parsed.challenger_doubles_onsite_cut_rank,
        alternate_entries_count: parsed.alternate_entries_count,
        lucky_loser_count: parsed.lucky_loser_count,
      };

      if (parsed.last_direct_acceptance_rank == null) {
        importedNullCuts.push(importedItem);
      } else {
        importedWithCuts.push(importedItem);
      }
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
    atpOnly,
    sourceCount: officialPdfSources.length,
    totalTargets: allTargets.length,
    offset,
    limit,
    pageSize: pdfImportTargets.length,
    hasMore: offset + limit < allTargets.length,
    nextOffset: offset + limit < allTargets.length ? offset + limit : null,
    importedWithCutsCount: importedWithCuts.length,
    importedNullCutsCount: importedNullCuts.length,
    skippedNoPdfCount: skippedNoPdf.length,
    failedCount: failed.length,
    importedWithCuts,
    importedNullCuts,
    skippedNoPdf,
    failed,
    missing_code_mappings: missingCodeMappings,
  });
}

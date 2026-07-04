import { isAvailableSeason, AVAILABLE_SEASONS } from '@/lib/seasons';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_TO_CANONICAL_CODE = new Map<string, string>(
  ALL_EDITIONS
    .filter((edition) => edition.edition.protennislive_code)
    .map((edition) => [edition.tournament.slug, String(edition.edition.protennislive_code)])
);

const SLUG_HAS_DOUBLES_QUALIFYING = new Set(
  ALL_EDITIONS
    .filter((edition) => edition.edition.has_doubles_qualifying)
    .map((edition) => edition.tournament.slug)
);

type DrawKey =
  | 'singles_main'
  | 'singles_qualifying'
  | 'doubles_main'
  | 'doubles_qualifying';

type EditionCoverageRow = {
  edition_id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  year: number;
  week: number | null;
  start_date: string;
  level: string;
  source_url: string | null;
  has_singles_main: boolean;
  has_singles_qualifying: boolean;
  has_doubles_main: boolean;
  has_doubles_qualifying: boolean;
  source_notes: string[];
};

const PDF_NAMES: Record<DrawKey, string[]> = {
  singles_main: ['mds.pdf', 'mds-1.pdf', 'mds-2.pdf', 'mds-3.pdf', 'md.pdf', 'ms.pdf', 'ad.pdf', 'mds-final.pdf'],
  singles_qualifying: ['qs.pdf', 'qs-1.pdf', 'qs-2.pdf', 'q.pdf', 'qsa.pdf', 'qs-final.pdf'],
  doubles_main: ['mdd.pdf', 'mdd-1.pdf', 'mdd-2.pdf', 'mdd-3.pdf', 'md.pdf', 'dd.pdf', 'mdd-final.pdf'],
  doubles_qualifying: ['qd.pdf', 'qd-1.pdf', 'qdd.pdf'],
};

function extractCodeFromTextSources(sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const match = source.match(/\/posting\/\d+\/(\d+)\//);
    if (match) return match[1];
  }
  return null;
}

function expectedDraws(row: EditionCoverageRow): DrawKey[] {
  const level = row.level.toLowerCase();
  // Slams split across two tournament entries: the main event carries
  // singles + doubles only, "<Slam> Qualifying" just the singles-qualifying
  // line — mirror expectedDrawsForLevel on the tournament page so the report
  // stops flagging draws a slam entry can never have.
  if (level === 'grand slam qualifying') return ['singles_qualifying'];
  if (level === 'grand slam') return ['singles_main', 'doubles_main'];
  const isChallenger = level.includes('challenger');
  const isAtp500 = level.includes('500') && !isChallenger;

  const draws: DrawKey[] = ['singles_main', 'singles_qualifying', 'doubles_main'];

  // V1 rule: Challenger doubles qualifying should not be expected.
  // ATP 500 has a special doubles-qualifying case; other Tour levels can be added later.
  if (isAtp500 || SLUG_HAS_DOUBLES_QUALIFYING.has(row.slug)) {
    draws.push('doubles_qualifying');
  }

  return draws;
}

function hasDraw(row: EditionCoverageRow, draw: DrawKey) {
  switch (draw) {
    case 'singles_main':
      return row.has_singles_main;
    case 'singles_qualifying':
      return row.has_singles_qualifying;
    case 'doubles_main':
      return row.has_doubles_main;
    case 'doubles_qualifying':
      return row.has_doubles_qualifying;
  }
}

function candidateYears(row: EditionCoverageRow) {
  const startCalendarYear = Number(row.start_date.slice(0, 4));
  return Array.from(new Set([row.year, startCalendarYear, startCalendarYear - 1, startCalendarYear + 1])).filter(
    (year) => Number.isFinite(year)
  );
}

function confidenceFor(row: EditionCoverageRow, code: string | null) {
  if (SLUG_TO_CANONICAL_CODE.has(row.slug)) {
    return {
      level: 'high',
      reason: 'Permanent ProTennisLive code is mapped from the canonical tournament registry.',
    };
  }

  if (code) {
    return {
      level: 'medium',
      reason: 'ProTennisLive code was recovered from an existing PDF source note or source URL.',
    };
  }

  return {
    level: 'low',
    reason: 'No ProTennisLive code is known yet; this needs code discovery before cuts can be auto-filled.',
  };
}

function buildCandidateUrls(row: EditionCoverageRow, code: string | null, draw: DrawKey) {
  if (!code) return [];

  return candidateYears(row).flatMap((year) =>
    PDF_NAMES[draw].map((pdfName) => `https://www.protennislive.com/posting/${year}/${code}/${pdfName}`)
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? '2024');
  const limit = Math.min(Number(params.get('limit') ?? '500'), 1000);
  const offset = Number(params.get('offset') ?? '0');
  const compact = params.get('compact') === 'true';

  if (!isAvailableSeason(year)) {
    return NextResponse.json(
      { ok: false, error: `year must be one of ${AVAILABLE_SEASONS.join(', ')}` },
      { status: 400 }
    );
  }

  const rowsResult = await pool.query<EditionCoverageRow>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      t.city,
      t.country,
      te.year,
      te.week,
      te.start_date::text as start_date,
      te.level,
      te.source_url,
      exists(
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'singles'
          and cs.draw_type = 'main'
          and cs.last_direct_acceptance_rank is not null
      ) as has_singles_main,
      exists(
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'singles'
          and cs.draw_type = 'qualifying'
          and cs.last_direct_acceptance_rank is not null
      ) as has_singles_qualifying,
      exists(
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'doubles'
          and cs.draw_type = 'main'
          and (
            cs.last_direct_acceptance_rank is not null
            or cs.challenger_doubles_advanced_cut_rank is not null
            or cs.challenger_doubles_onsite_cut_rank is not null
          )
      ) as has_doubles_main,
      exists(
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'doubles'
          and cs.draw_type = 'qualifying'
          and cs.last_direct_acceptance_rank is not null
      ) as has_doubles_qualifying,
      coalesce(
        array_agg(cs.source_notes) filter (where cs.source_notes is not null),
        array[]::text[]
      ) as source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.status = 'held'
      and te.year = $1
      and te.level not ilike 'ITF%'
      and te.start_date is not null
      and (
        (
          extract(year from te.start_date) = te.year
          and extract(month from te.start_date) <> 12
        )
        or (
          extract(year from te.start_date) = te.year - 1
          and extract(month from te.start_date) = 12
        )
      )
    group by te.id, t.slug, t.name, t.city, t.country, te.year, te.week, te.start_date, te.level, te.source_url
    order by te.start_date, t.name
    limit $2 offset $3
    `,
    [year, limit, offset]
  );

  const report = rowsResult.rows.map((row) => {
    const code = SLUG_TO_CANONICAL_CODE.get(row.slug) ?? extractCodeFromTextSources([row.source_url, ...row.source_notes]);
    const expected = expectedDraws(row);
    const missing = expected.filter((draw) => !hasDraw(row, draw));
    const present = expected.filter((draw) => hasDraw(row, draw));
    const confidence = confidenceFor(row, code);

    if (compact) {
      // Tiny shape per row so the whole report fits in a chat paste.
      // Skip the verbose URL candidate list and the per-row reason text.
      return {
        slug: row.slug,
        name: row.name,
        week: row.week,
        start_date: row.start_date,
        level: row.level,
        code,
        missing: missing,
        confidence: confidence.level,
      };
    }

    return {
      slug: row.slug,
      name: row.name,
      city: row.city,
      country: row.country,
      year: row.year,
      week: row.week,
      start_date: row.start_date,
      level: row.level,
      protennislive_code: code,
      expected_draws: expected,
      present_draws: present,
      missing_draws: missing,
      missing_count: missing.length,
      confidence,
      next_action:
        missing.length === 0
          ? 'complete'
          : code
            ? 'run /api/run-all to try these ProTennisLive PDF candidates'
            : 'discover the ProTennisLive code, then rerun /api/run-all',
      candidate_urls_by_missing_draw: Object.fromEntries(
        missing.map((draw) => [draw, buildCandidateUrls(row, code, draw).slice(0, 12)])
      ),
    };
  });

  const missingReport = report.filter((row) =>
    compact ? (row as { missing: DrawKey[] }).missing.length > 0 : (row as { missing_count: number }).missing_count > 0
  );
  const completeReport = report.filter((row) =>
    compact ? (row as { missing: DrawKey[] }).missing.length === 0 : (row as { missing_count: number }).missing_count === 0
  );

  const confidenceCounts = missingReport.reduce<Record<string, number>>((acc, row) => {
    const level = compact
      ? (row as { confidence: string }).confidence
      : (row as { confidence: { level: string } }).confidence.level;
    acc[level] = (acc[level] ?? 0) + 1;
    return acc;
  }, {});

  if (compact) {
    return NextResponse.json({
      ok: true,
      year,
      totalReturned: report.length,
      completeCount: completeReport.length,
      missingEditionCount: missingReport.length,
      missingDrawCount: missingReport.reduce(
        (sum, row) => sum + (row as { missing: DrawKey[] }).missing.length,
        0
      ),
      confidenceCounts,
      missing: missingReport,
    });
  }

  return NextResponse.json({
    ok: true,
    year,
    offset,
    limit,
    totalReturned: report.length,
    completeCount: completeReport.length,
    missingEditionCount: missingReport.length,
    missingDrawCount: missingReport.reduce(
      (sum, row) => sum + (row as { missing_count: number }).missing_count,
      0
    ),
    confidenceCounts,
    missing: missingReport,
    complete: completeReport,
  });
}

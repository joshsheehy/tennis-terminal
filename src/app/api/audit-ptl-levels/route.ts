import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool } from '@/lib/db';
import { isAvailableSeason, AVAILABLE_SEASONS } from '@/lib/seasons';
import { getAtpEditionYearForStartDate } from '@/lib/atp-week';
import { fetchPtlHeader } from '@/lib/ptl-header';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Audits a season's edition levels against the ProTennisLive posting headers —
// the ATP's own era-correct record. Catalogue- and template-based imports
// suffer survivorship bias: a code whose tournament changed tier (Newport:
// ATP 250 through 2024, Challenger 125 from 2025) ends up with one era's
// level stamped onto another. The posting header for a given year says what
// the event actually was THAT year, so it wins.
//
//   GET /api/audit-ptl-levels?year=2022               → dry run (report only)
//   GET /api/audit-ptl-levels?year=2022&apply=true    → fix mismatched levels
//
// Paged like import-cutoffs: &limit=40&offset=N, respects a server-side time
// budget and returns hasMore/nextOffset for the workflow to follow.
//
// Tour postings state TOTAL FINANCIAL COMMITMENT rather than a category, so
// the header can only prove "this was a Tour event" (the 250-vs-500 split is
// a money guess). The audit therefore only flags CROSS-TIER mismatches for
// tour postings (DB says Challenger, posting says Tour) and exact mismatches
// when the posting carries an explicit "Challenger NN" category.

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const BUDGET_MS = 25_000;

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  year: number;
  level: string;
  source_url: string | null;
  source_notes: string | null;
};

const ATP_ARCHIVE = /\/archive\/[^/]+\/(\d+)\/\d{4}\/results/i;
const PROTENNISLIVE = /\/posting\/\d+\/(\d+)\//;

function codeFromUrls(...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(ATP_ARCHIVE) ?? candidate.match(PROTENNISLIVE);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year'));
  if (!isAvailableSeason(year)) {
    return NextResponse.json(
      { ok: false, error: `year must be one of ${AVAILABLE_SEASONS.join(', ')}` },
      { status: 400 }
    );
  }
  const apply = params.get('apply') === 'true';
  const limitParam = Number(params.get('limit'));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  // Editions of the season worth auditing, with every URL that could carry a
  // PTL code. Codes are permanent per tournament, so a code found on ANY
  // edition (or in the static catalogue) applies to all of a slug's years.
  const editionsResult = await pool.query<EditionRow>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      te.year,
      te.level,
      te.source_url,
      (
        select cs.source_notes
        from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id and cs.source_notes is not null
        limit 1
      ) as source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'held'
      and (te.level like 'ATP %' or te.level ilike 'Challenger%')
    order by t.slug
    `,
    [year]
  );

  // Slug → code fallback: any edition year in the DB, then the static catalogue.
  const fallbackResult = await pool.query<{ slug: string; source_url: string | null; source_notes: string | null }>(
    `
    select t.slug, te.source_url, cs.source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.source_url is not null or cs.source_notes is not null
    `
  );
  const codeBySlug = new Map<string, string>();
  for (const row of fallbackResult.rows) {
    if (codeBySlug.has(row.slug)) continue;
    const code = codeFromUrls(row.source_url, row.source_notes);
    if (code) codeBySlug.set(row.slug, code);
  }
  for (const entry of ALL_EDITIONS) {
    if (!entry.edition.protennislive_code) continue;
    if (!codeBySlug.has(entry.tournament.slug)) {
      codeBySlug.set(entry.tournament.slug, String(entry.edition.protennislive_code));
    }
  }

  const withCodes = editionsResult.rows.map((row) => ({
    ...row,
    code: codeFromUrls(row.source_url, row.source_notes) ?? codeBySlug.get(row.slug) ?? null,
  }));
  const missingCode = withCodes.filter((row) => !row.code).map((row) => row.slug);
  const targets = withCodes.filter((row): row is typeof row & { code: string } => Boolean(row.code));

  const page = targets.slice(offset, offset + limit);

  const mismatches: Array<{
    slug: string;
    year: number;
    code: string;
    dbLevel: string;
    ptlLevel: string;
    applied: boolean;
  }> = [];
  const confirmed: string[] = [];
  const unverifiable: Array<{ slug: string; code: string; reason: string }> = [];

  const startedAt = Date.now();
  let processedCount = 0;
  let budgetExceeded = false;
  let appliedCount = 0;

  for (const target of page) {
    if (Date.now() - startedAt > BUDGET_MS) {
      budgetExceeded = true;
      break;
    }
    processedCount += 1;

    const result = await fetchPtlHeader(year, target.code);
    if (!result.header) {
      unverifiable.push({ slug: target.slug, code: target.code, reason: result.skip ?? 'unparsed' });
      continue;
    }
    const header = result.header;

    // Wrong-year guard: PTL can serve a different season's sheet at an old
    // path. Only trust headers whose dates land in the audited season.
    const headerYear = getAtpEditionYearForStartDate(header.startDate, Number(header.startDate.slice(0, 4)));
    if (headerYear !== target.year) {
      unverifiable.push({
        slug: target.slug,
        code: target.code,
        reason: `header dates are ${header.startDate} (season ${headerYear}, expected ${target.year})`,
      });
      continue;
    }

    const dbIsTour = /^ATP \d+/.test(target.level);
    let correctLevel: string | null = null;
    if (header.tourLevelHeuristic) {
      // Posting proves Tour; the exact 250/500 split is a money guess, so an
      // existing tour level in the DB is treated as already correct.
      if (!dbIsTour) correctLevel = header.level;
    } else if (header.level !== target.level) {
      // Explicit "Challenger NN" category — era-correct, trust it exactly.
      correctLevel = header.level;
    }

    if (!correctLevel) {
      confirmed.push(target.slug);
      continue;
    }

    let applied = false;
    if (apply) {
      await pool.query(
        `update tournament_editions set level = $1, updated_at = now() where id = $2`,
        [correctLevel, target.edition_id]
      );
      applied = true;
      appliedCount += 1;
    }
    mismatches.push({
      slug: target.slug,
      year: target.year,
      code: target.code,
      dbLevel: target.level,
      ptlLevel: correctLevel,
      applied,
    });
  }

  if (appliedCount > 0) {
    try {
      revalidateTag('schedule');
    } catch {
      // revalidateTag can throw outside the cache runtime; safe to swallow.
    }
  }

  const processedUpTo = offset + processedCount;
  const hasMore = budgetExceeded ? true : processedUpTo < targets.length;

  return NextResponse.json({
    ok: true,
    year,
    apply,
    totalTargets: targets.length,
    offset,
    limit,
    processedCount,
    budgetExceeded,
    hasMore,
    nextOffset: hasMore ? processedUpTo : null,
    mismatchCount: mismatches.length,
    appliedCount,
    confirmedCount: confirmed.length,
    unverifiableCount: unverifiable.length,
    mismatches,
    unverifiable,
    missingCodeCount: missingCode.length,
    missingCode: missingCode.slice(0, 20),
    message: apply
      ? 'Mismatched levels updated from PTL posting headers.'
      : 'Dry run. Append &apply=true to fix mismatched levels.',
  });
}

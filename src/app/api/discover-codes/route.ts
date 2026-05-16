import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

type MissingEdition = {
  week: number | null;
  slug: string;
  name: string;
  city: string;
  start_date: string;
};

type MatchConfidence = 'high' | 'medium' | 'low';

type MatchCandidate = {
  code: number;
  pdf_url: string;
  titleSnippet: string;
  matched_slug: string;
  matched_name: string;
  matched_city: string;
  confidence: MatchConfidence;
  evidence: string[];
};

type WorkingUnknown = {
  code: number;
  pdf_url: string;
  titleSnippet: string;
  possibleMatches: Array<{
    matched_slug: string;
    matched_name: string;
    matched_city: string;
    confidence: MatchConfidence;
    evidence: string[];
  }>;
};

type PdfParseResult = { text: string };
type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_TYPES = ['mds.pdf', 'qs.pdf', 'mdd.pdf'] as const;
const DEFAULT_MAX_REQUESTS = 500;
const HARD_MAX_REQUESTS = 1000;
const DEFAULT_CONCURRENCY = 5;
const HARD_MAX_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 9000;

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAliases(value: string) {
  const normalized = normalize(value);
  const aliases = new Set<string>([normalized]);
  normalized.split(' ').forEach((token) => {
    if (token.length >= 4) aliases.add(token);
  });
  return Array.from(aliases);
}

const GENERIC_ALIAS_TOKENS = new Set([
  'challenger',
  'open',
  'tennis',
  'singles',
  'doubles',
  'main',
  'draw',
  'qualifying',
  'city',
  '50',
  '75',
  '100',
  '125',
  '175',
]);

function getMeaningfulTokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_ALIAS_TOKENS.has(token) && !/^\d+$/.test(token));
}

function parseNumberParam(value: string | null, field: string) {
  if (!value) throw new Error(`${field} is required`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function parseYearParam(value: string | null): number {
  const year = value ? Number(value) : 2026;
  if (![2024, 2025, 2026].includes(year)) throw new Error('year must be 2024, 2025, or 2026');
  return year;
}

function getMissingEditionsFromCanonical(weekFilter: number | null): MissingEdition[] {
  return ALL_EDITIONS
    .filter((item) => item.edition.status === 'held' && item.edition.year === 2026 && item.edition.protennislive_code === null)
    .filter((item) => (weekFilter === null ? true : item.edition.week === weekFilter))
    .map((item) => ({
      week: item.edition.week,
      slug: item.tournament.slug,
      name: item.tournament.name,
      city: item.tournament.city,
      start_date: item.edition.start_date,
    }));
}

// Returns DB editions for a historical year (2024/2025) that have no
// recoverable ProTennisLive code anywhere — not in the static catalogue,
// not in te.source_url, and not in cutoff_snapshots.source_notes.
// These are the tournaments that need brute-force code discovery to fill.
async function getMissingEditionsFromDb(
  year: number,
  weekFilter: number | null
): Promise<MissingEdition[]> {
  const canonicalCoded = new Set(
    ALL_EDITIONS
      .filter((item) => item.edition.protennislive_code !== null)
      .map((item) => item.tournament.slug)
  );

  const result = await pool.query<{
    slug: string;
    name: string;
    city: string;
    week: number | null;
    start_date: string;
    source_url: string | null;
    source_notes: string | null;
  }>(
    `
    select
      t.slug, t.name, t.city,
      te.week, te.start_date::text as start_date,
      te.source_url, cs.source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.year = $1
      and te.status = 'held'
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
    `,
    [year]
  );

  const PROTENNISLIVE = /\/posting\/\d+\/(\d+)\//;
  const ATP_ARCHIVE = /\/archive\/[^/]+\/(\d+)\/\d{4}\/results/i;

  const bySlug = new Map<string, MissingEdition>();
  const slugsWithCode = new Set<string>();

  for (const row of result.rows) {
    if (canonicalCoded.has(row.slug)) {
      slugsWithCode.add(row.slug);
      continue;
    }
    const sources = [row.source_url, row.source_notes];
    const hasCode = sources.some((s) => s && (PROTENNISLIVE.test(s) || ATP_ARCHIVE.test(s)));
    if (hasCode) {
      slugsWithCode.add(row.slug);
      continue;
    }
    if (weekFilter !== null && row.week !== weekFilter) continue;
    if (!bySlug.has(row.slug)) {
      bySlug.set(row.slug, {
        week: row.week,
        slug: row.slug,
        name: row.name,
        city: row.city,
        start_date: row.start_date,
      });
    }
  }

  for (const slug of slugsWithCode) bySlug.delete(slug);
  return Array.from(bySlug.values());
}

async function resolveMissingEditions(
  year: number,
  weekFilter: number | null
): Promise<MissingEdition[]> {
  if (year === 2026) return getMissingEditionsFromCanonical(weekFilter);
  return getMissingEditionsFromDb(year, weekFilter);
}

async function fetchPdfText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/pdf,*/*;q=0.8', 'user-agent': 'TennisTerminalCodeDiscovery/0.1' },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('pdf')) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse') as PdfParseFunction;
    const parsed = await pdfParse(buffer);

    return parsed.text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTitleSnippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function evaluateMatch(text: string, tournament: MissingEdition) {
  const normalizedText = normalize(text);
  const evidence: string[] = [];
  let score = 0;

  const nameTokens = getMeaningfulTokens(tournament.name);
  const cityTokens = getMeaningfulTokens(tournament.city);
  const exactNormalizedCity = normalize(tournament.city);

  const nameTokenMatches = nameTokens.filter((token) => normalizedText.includes(token));
  const hasMeaningfulNameMatch = nameTokenMatches.length > 0;
  if (hasMeaningfulNameMatch) {
    score += 2;
    evidence.push(`event-name token match: ${nameTokenMatches.join(', ')}`);
  }

  const hasExactCityMatch = exactNormalizedCity.length > 0 && normalizedText.includes(exactNormalizedCity);
  const cityTokenMatches = cityTokens.filter((token) => normalizedText.includes(token));
  const hasCityTokenMatch = cityTokenMatches.length > 0;

  if (hasExactCityMatch) {
    score += 3;
    evidence.push('exact normalized city match');
  } else if (hasCityTokenMatch) {
    score += 2;
    evidence.push(`city token match: ${cityTokenMatches.join(', ')}`);
  }

  const startDate = new Date(tournament.start_date);
  if (!Number.isNaN(startDate.getTime())) {
    const monthDay = `${startDate.getUTCDate()}`;
    const year = `${startDate.getUTCFullYear()}`;
    if (normalizedText.includes(monthDay) && normalizedText.includes(year)) {
      if (hasMeaningfulNameMatch || hasExactCityMatch || hasCityTokenMatch) {
        score += 1;
        evidence.push('date hints found in PDF text');
      } else {
        evidence.push('date hints ignored without name/city evidence');
      }
    }
  }

  if (tournament.week !== null) {
    const weekToken = `week ${tournament.week}`;
    if (normalizedText.includes(weekToken)) {
      score += 1;
      evidence.push('week token found in PDF text');
    }
  }

  if (hasExactCityMatch && hasMeaningfulNameMatch) {
    score += 1;
    evidence.push('city + meaningful event-name token synergy');
  }

  if (score >= 4) return { confidence: 'high' as const, evidence };
  if (score >= 3) return { confidence: 'medium' as const, evidence };
  if (score >= 2) return { confidence: 'low' as const, evidence };

  return null;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  });

  await Promise.all(workers);
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startCode = parseNumberParam(searchParams.get('startCode'), 'startCode');
    const endCode = parseNumberParam(searchParams.get('endCode'), 'endCode');
    if (endCode < startCode) throw new Error('endCode must be >= startCode');

    const week = searchParams.get('week');
    const weekFilter = week ? parseNumberParam(week, 'week') : null;

    const maxRequestsRaw = searchParams.get('maxRequests');
    const maxRequests = Math.min(
      HARD_MAX_REQUESTS,
      maxRequestsRaw ? parseNumberParam(maxRequestsRaw, 'maxRequests') : DEFAULT_MAX_REQUESTS
    );

    const concurrencyRaw = searchParams.get('concurrency');
    const concurrency = Math.min(
      HARD_MAX_CONCURRENCY,
      concurrencyRaw ? parseNumberParam(concurrencyRaw, 'concurrency') : DEFAULT_CONCURRENCY
    );

    const requestedCount = endCode - startCode + 1;
    if (requestedCount > maxRequests) {
      return NextResponse.json(
        {
          ok: false,
          error: `Requested range (${requestedCount}) exceeds maxRequests (${maxRequests}).`,
        },
        { status: 400 }
      );
    }

    const year = parseYearParam(searchParams.get('year'));
    const apply = searchParams.get('apply') === 'true';
    const applyMinConfidence = (searchParams.get('applyMinConfidence') ?? 'high') as MatchConfidence;

    const missing = await resolveMissingEditions(year, weekFilter);
    const tasks: Array<() => Promise<{ code: number; pdf_url: string; text: string | null }>> = [];

    for (let code = startCode; code <= endCode; code += 1) {
      for (const pdfType of PDF_TYPES) {
        const pdf_url = `https://www.protennislive.com/posting/${year}/${code}/${pdfType}`;
        tasks.push(async () => ({ code, pdf_url, text: await fetchPdfText(pdf_url) }));
      }
    }

    const results = await runWithConcurrency(tasks, concurrency);
    const matches: MatchCandidate[] = [];
    const workingUnknown: WorkingUnknown[] = [];
    let workingPdfCount = 0;

    for (const result of results) {
      if (!result.text) continue;
      workingPdfCount += 1;

      const titleSnippet = extractTitleSnippet(result.text);
      const scoredMatches: Array<MatchCandidate & { scoreRank: number }> = [];

      for (const candidate of missing) {
        const evaluated = evaluateMatch(result.text, candidate);
        if (!evaluated) continue;

        const scoreRank = evaluated.confidence === 'high' ? 3 : evaluated.confidence === 'medium' ? 2 : 1;
        scoredMatches.push({
          code: result.code,
          pdf_url: result.pdf_url,
          titleSnippet,
          matched_slug: candidate.slug,
          matched_name: candidate.name,
          matched_city: candidate.city,
          confidence: evaluated.confidence,
          evidence: evaluated.evidence,
          scoreRank,
        });
      }

      if (scoredMatches.length > 0) {
        scoredMatches.sort((a, b) => b.scoreRank - a.scoreRank);
        const bestRank = scoredMatches[0].scoreRank;
        const strongestMatches = scoredMatches.filter((match) => match.scoreRank === bestRank);
        for (const strongest of strongestMatches) {
          const { scoreRank: _, ...record } = strongest;
          matches.push(record);
        }
      } else {
        workingUnknown.push({
          code: result.code,
          pdf_url: result.pdf_url,
          titleSnippet,
          possibleMatches: [],
        });
      }
    }

    const applied: Array<{ slug: string; code: number; pdf_url: string; confidence: MatchConfidence }> = [];
    if (apply && matches.length > 0) {
      const confidenceRank: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };
      const minRank = confidenceRank[applyMinConfidence] ?? confidenceRank.high;
      // Take the highest-confidence match per slug to avoid writing the wrong code.
      const bestBySlug = new Map<string, MatchCandidate>();
      for (const m of matches) {
        if (confidenceRank[m.confidence] < minRank) continue;
        const existing = bestBySlug.get(m.matched_slug);
        if (!existing || confidenceRank[m.confidence] > confidenceRank[existing.confidence]) {
          bestBySlug.set(m.matched_slug, m);
        }
      }
      for (const match of bestBySlug.values()) {
        // Write the ProTennisLive URL to te.source_url for the matching edition(s) in the requested year.
        // Subsequent /api/run-all and /api/import-cutoffs will pick this up via the URL regex.
        await pool.query(
          `update tournament_editions te
           set source_url = $3, updated_at = now()
           from tournaments t
           where te.tournament_id = t.id
             and t.slug = $1
             and te.year = $2
             and (te.source_url is null or te.source_url !~ '/posting/\\d+/\\d+/')`,
          [match.matched_slug, year, match.pdf_url]
        );
        applied.push({
          slug: match.matched_slug,
          code: match.code,
          pdf_url: match.pdf_url,
          confidence: match.confidence,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      year,
      range: { startCode, endCode },
      testedCount: tasks.length,
      workingPdfCount,
      matches,
      workingUnknown,
      unmatchedMissingCodes: missing,
      apply,
      applyMinConfidence,
      applied,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

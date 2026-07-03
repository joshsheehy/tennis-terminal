import { EARLIEST_SEASON } from '@/lib/seasons';
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
// Soft wall-time budget per request. Browsers and many edge proxies cap at ~30s,
// so we return progress + nextStartCode just under that and let the caller retry.
const TIME_BUDGET_MS = 22000;

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const year = value ? Number(value) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < EARLIEST_SEASON || year > 2030) {
    throw new Error(`year must be between ${EARLIEST_SEASON} and 2030`);
  }
  return year;
}

// Returns DB editions for a year that have no recoverable ProTennisLive code
// anywhere — not in the static catalogue, not in te.source_url, and not in
// cutoff_snapshots.source_notes. These are the tournaments that need
// brute-force code discovery to fill. Reading from the DB (not the static
// catalogue) is what lets freshly calendar-discovered tournaments get codes:
// they exist only as DB rows. ITF events never have PTL postings, so only
// Challenger + ATP Tour levels are eligible.
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
      and (te.level ilike 'Challenger%' or te.level ~* 'ATP\\s*(250|500|1000)')
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
  return getMissingEditionsFromDb(year, weekFilter);
}

// Known PTL codes for a year (catalogue + DB source_url/source_notes) — the
// anchor for auto-ranged scans: new events get codes allocated near the top
// of the existing band, so scan [max - back, max + ahead].
async function getKnownCodesForYear(year: number): Promise<number[]> {
  const codes = new Set<number>();
  for (const item of ALL_EDITIONS) {
    if (item.edition.year === year && item.edition.protennislive_code) {
      const n = Number(item.edition.protennislive_code);
      if (Number.isFinite(n)) codes.add(n);
    }
  }
  const result = await pool.query<{ code: string }>(
    `
    select distinct code from (
      select (regexp_match(te.source_url, '/posting/\\d+/(\\d+)/'))[1] as code
      from tournament_editions te
      where te.year = $1 and te.source_url ~ '/posting/\\d+/\\d+/'
      union all
      select (regexp_match(cs.source_notes, '/posting/\\d+/(\\d+)/'))[1] as code
      from cutoff_snapshots cs
      join tournament_editions te on te.id = cs.tournament_edition_id
      where te.year = $1 and cs.source_notes ~ '/posting/\\d+/\\d+/'
    ) x where code is not null
    `,
    [year]
  );
  for (const row of result.rows) {
    const n = Number(row.code);
    if (Number.isFinite(n)) codes.add(n);
  }
  return Array.from(codes);
}

async function fetchPdfText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/pdf,*/*;q=0.8', 'user-agent': 'TennisCutsCodeDiscovery/0.1' },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('pdf')) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Deliberate lazy require: top-level pdf-parse imports crash under bundlers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    const year = parseYearParam(searchParams.get('year'));

    const week = searchParams.get('week');
    const weekFilter = week ? parseNumberParam(week, 'week') : null;

    const missing = await resolveMissingEditions(year, weekFilter);
    if (missing.length === 0) {
      // Nothing to match against — skip the (expensive) PDF scan entirely.
      // The nightly workflow calls this unconditionally; this makes the
      // no-work night free.
      return NextResponse.json({
        ok: true,
        year,
        skipped: true,
        reason: 'No Challenger/ATP editions are missing a ProTennisLive code.',
        hasMore: false,
        matches: [],
        applied: [],
        unmatchedMissingCodes: [],
      });
    }

    // Auto range: anchor on the codes we already know for this season.
    // startCode/endCode can still override either bound (paged resumes pass
    // startCode=nextStartCode&endCode=<first response's range.endCode>).
    let startCode: number;
    let endCode: number;
    if (searchParams.get('auto') === 'true') {
      const known = await getKnownCodesForYear(year);
      if (known.length === 0) {
        throw new Error(`auto range requested but no known ProTennisLive codes exist for ${year}`);
      }
      const maxKnown = Math.max(...known);
      const back = Number(searchParams.get('back') ?? 120);
      const ahead = Number(searchParams.get('ahead') ?? 160);
      startCode = searchParams.get('startCode')
        ? parseNumberParam(searchParams.get('startCode'), 'startCode')
        : Math.max(1, maxKnown - back);
      endCode = searchParams.get('endCode')
        ? parseNumberParam(searchParams.get('endCode'), 'endCode')
        : maxKnown + ahead;
    } else {
      startCode = parseNumberParam(searchParams.get('startCode'), 'startCode');
      endCode = parseNumberParam(searchParams.get('endCode'), 'endCode');
    }
    if (endCode < startCode) throw new Error('endCode must be >= startCode');

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

    const apply = searchParams.get('apply') === 'true';
    const applyMinConfidence = (searchParams.get('applyMinConfidence') ?? 'high') as MatchConfidence;

    const matches: MatchCandidate[] = [];
    const workingUnknown: WorkingUnknown[] = [];
    let workingPdfCount = 0;
    let testedCount = 0;

    const start = Date.now();
    let lastProcessedCode = startCode - 1;
    let timedOut = false;
    // Process one code at a time (3 PDFs concurrently within the code, plus pipelined
    // across codes via runWithConcurrency in small batches). After each batch, check
    // the time budget and bail out so the caller can resume from nextStartCode.
    const BATCH = Math.max(1, concurrency);
    for (let code = startCode; code <= endCode; code += BATCH) {
      if (Date.now() - start > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }
      const batchEnd = Math.min(endCode, code + BATCH - 1);
      const tasks: Array<() => Promise<{ code: number; pdf_url: string; text: string | null }>> = [];
      for (let c = code; c <= batchEnd; c += 1) {
        for (const pdfType of PDF_TYPES) {
          const pdf_url = `https://www.protennislive.com/posting/${year}/${c}/${pdfType}`;
          tasks.push(async () => ({ code: c, pdf_url, text: await fetchPdfText(pdf_url) }));
        }
      }
      const results = await runWithConcurrency(tasks, concurrency);
      testedCount += tasks.length;
      lastProcessedCode = batchEnd;

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
    }
    const hasMore = timedOut && lastProcessedCode < endCode;
    const nextStartCode = hasMore ? lastProcessedCode + 1 : null;

    const applied: Array<{ slug: string; code: number; pdf_url: string; confidence: MatchConfidence }> = [];
    const ambiguousCodes: Array<{ code: number; slugs: string[] }> = [];
    if (apply && matches.length > 0) {
      const confidenceRank: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };
      const minRank = confidenceRank[applyMinConfidence] ?? confidenceRank.high;

      // A ProTennisLive code identifies exactly ONE tournament. Entry-list
      // PDFs are full of player names that can collide with other events'
      // city/name tokens, so a code whose text "matches" several different
      // tournaments is ambiguous — auto-applying it would write the same code
      // to multiple slugs and later dedupe-by-code could merge unrelated
      // tournaments. Skip those codes entirely; they stay in `matches` for a
      // human to resolve.
      const slugsByCode = new Map<number, Set<string>>();
      for (const m of matches) {
        if (confidenceRank[m.confidence] < minRank) continue;
        if (!slugsByCode.has(m.code)) slugsByCode.set(m.code, new Set());
        slugsByCode.get(m.code)!.add(m.matched_slug);
      }
      const unambiguousCodes = new Set<number>();
      for (const [code, slugs] of slugsByCode) {
        if (slugs.size === 1) unambiguousCodes.add(code);
        else ambiguousCodes.push({ code, slugs: Array.from(slugs) });
      }

      // Take the highest-confidence match per slug to avoid writing the wrong code.
      const bestBySlug = new Map<string, MatchCandidate>();
      for (const m of matches) {
        if (confidenceRank[m.confidence] < minRank) continue;
        if (!unambiguousCodes.has(m.code)) continue;
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
      lastProcessedCode,
      nextStartCode,
      hasMore,
      testedCount,
      workingPdfCount,
      matches,
      workingUnknown,
      unmatchedMissingCodes: missing,
      apply,
      applyMinConfidence,
      applied,
      ambiguousCodes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

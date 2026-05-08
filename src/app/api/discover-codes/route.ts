import { NextRequest, NextResponse } from 'next/server';
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
};

type PdfParseResult = { text: string };
type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_TYPES = ['mds.pdf', 'qs.pdf', 'mdd.pdf'] as const;
const DEFAULT_MAX_REQUESTS = 300;
const HARD_MAX_REQUESTS = 500;
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

function parseNumberParam(value: string | null, field: string) {
  if (!value) throw new Error(`${field} is required`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function getMissingEditions(weekFilter: number | null): MissingEdition[] {
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

  const nameAliases = getAliases(tournament.name);
  const cityAliases = getAliases(tournament.city);

  if (nameAliases.some((alias) => alias && normalizedText.includes(alias))) {
    score += 2;
    evidence.push('name/alias found in PDF text');
  }

  if (cityAliases.some((alias) => alias && normalizedText.includes(alias))) {
    score += 2;
    evidence.push('city/alias found in PDF text');
  }

  const startDate = new Date(tournament.start_date);
  if (!Number.isNaN(startDate.getTime())) {
    const monthDay = `${startDate.getUTCDate()}`;
    const year = `${startDate.getUTCFullYear()}`;
    if (normalizedText.includes(monthDay) && normalizedText.includes(year)) {
      score += 1;
      evidence.push('date hints found in PDF text');
    }
  }

  if (tournament.week !== null) {
    const weekToken = `week ${tournament.week}`;
    if (normalizedText.includes(weekToken)) {
      score += 1;
      evidence.push('week token found in PDF text');
    }
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

    const missing = getMissingEditions(weekFilter);
    const tasks: Array<() => Promise<{ code: number; pdf_url: string; text: string | null }>> = [];

    for (let code = startCode; code <= endCode; code += 1) {
      for (const pdfType of PDF_TYPES) {
        const pdf_url = `https://www.protennislive.com/posting/2026/${code}/${pdfType}`;
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

      let best: (MatchCandidate & { scoreRank: number }) | null = null;

      for (const candidate of missing) {
        const evaluated = evaluateMatch(result.text, candidate);
        if (!evaluated) continue;

        const scoreRank = evaluated.confidence === 'high' ? 3 : evaluated.confidence === 'medium' ? 2 : 1;
        if (!best || scoreRank > best.scoreRank) {
          best = {
            code: result.code,
            pdf_url: result.pdf_url,
            matched_slug: candidate.slug,
            matched_name: candidate.name,
            matched_city: candidate.city,
            confidence: evaluated.confidence,
            evidence: evaluated.evidence,
            scoreRank,
          };
        }
      }

      if (best) {
        const { scoreRank: _, ...record } = best;
        matches.push(record);
      } else {
        workingUnknown.push({
          code: result.code,
          pdf_url: result.pdf_url,
          titleSnippet: extractTitleSnippet(result.text),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      range: { startCode, endCode },
      testedCount: tasks.length,
      workingPdfCount,
      matches,
      workingUnknown,
      unmatchedMissingCodes: missing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

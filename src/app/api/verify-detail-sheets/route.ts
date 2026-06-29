import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only: probe whether the official ProTennisLive detail/fact sheet
// (/posting/{year}/{code}/ds.pdf) actually exists for every held Challenger +
// ATP edition. Answers "how many detail sheets really came through" with a
// hard number, not just "how many links render".
//
// Paged + time-budgeted like import-cutoffs so a single call never blows the
// Railway/edge timeout. Caller follows hasMore/nextOffset to completion.
//
//   GET /api/verify-detail-sheets?year=2026&limit=80&offset=0

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: '*/*',
};

// Code from the static catalogue (stable per slug).
const CATALOGUE_CODE_BY_SLUG = new Map<string, string>();
for (const e of ALL_EDITIONS) {
  if (!e.edition.protennislive_code) continue;
  if (!CATALOGUE_CODE_BY_SLUG.has(e.tournament.slug)) {
    CATALOGUE_CODE_BY_SLUG.set(e.tournament.slug, e.edition.protennislive_code);
  }
}

function resolveCode(slug: string, sourceUrl: string | null): string | null {
  const fromCatalogue = CATALOGUE_CODE_BY_SLUG.get(slug);
  if (fromCatalogue) return fromCatalogue;
  const m = (sourceUrl ?? '').match(/protennislive\.com\/posting\/\d{4}\/(\d+)/i);
  return m ? m[1] : null;
}

async function dsExists(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: 'HEAD', headers: BROWSER_HEADERS, cache: 'no-store', signal: controller.signal });
    if (res.status === 405) {
      res = await fetch(url, { method: 'GET', headers: { ...BROWSER_HEADERS, Range: 'bytes=0-0' }, cache: 'no-store', signal: controller.signal });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }
  const limit = Math.min(Number(sp.get('limit') ?? '80'), 200);
  const offset = Number(sp.get('offset') ?? '0');

  // One row per (slug, year) Challenger/ATP edition, dedup’d so generic +
  // exact-level duplicates don't double-count.
  const rows = await pool.query<{ slug: string; name: string; level: string; source_url: string | null }>(
    `select distinct on (t.slug) t.slug, t.name, te.level, te.source_url
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held'
       and te.year = $1
       and (te.level ilike 'Challenger%' or te.level ~* 'ATP\\s*(250|500|1000)')
     order by t.slug, te.updated_at desc nulls last`,
    [year]
  );

  const all = rows.rows;
  const page = all.slice(offset, offset + limit);

  const BUDGET_MS = 22_000;
  const startedAt = Date.now();
  let processed = 0;
  let exists = 0;
  let missing = 0;
  let noCode = 0;
  const missingList: Array<{ slug: string; name: string; level: string; url: string }> = [];
  const noCodeList: Array<{ slug: string; name: string; level: string }> = [];

  for (const r of page) {
    if (Date.now() - startedAt > BUDGET_MS) break;
    processed += 1;
    const code = resolveCode(r.slug, r.source_url);
    if (!code) {
      noCode += 1;
      if (noCodeList.length < 50) noCodeList.push({ slug: r.slug, name: r.name, level: r.level });
      continue;
    }
    const url = `https://www.protennislive.com/posting/${year}/${code}/ds.pdf`;
    if (await dsExists(url)) {
      exists += 1;
    } else {
      missing += 1;
      if (missingList.length < 60) missingList.push({ slug: r.slug, name: r.name, level: r.level, url });
    }
  }

  const nextOffset = offset + processed;
  const hasMore = nextOffset < all.length;

  return NextResponse.json({
    ok: true,
    year,
    totalEligible: all.length,
    processedThisCall: processed,
    offset,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
    existsCount: exists,
    missingCount: missing,
    noCodeCount: noCode,
    missingSample: missingList,
    noCodeSample: noCodeList,
  });
}

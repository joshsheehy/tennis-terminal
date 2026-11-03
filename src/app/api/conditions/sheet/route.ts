import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { parseSheetConditions } from '@/lib/conditions';
import { CONDITIONS_CACHE_TAG, saveSheet, sheetTargets } from '@/lib/edition-conditions';
import { extractRowText } from '@/lib/pdf-row-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: ball, court brand and surface from ProTennisLive detail sheets.
// protennislive.com rate-limits Railway, so a GitHub runner does the
// downloading (.github/workflows/conditions-sync.yml) — the same split as
// cut-sync.yml and /api/import-pdf-direct.
//
//   GET  /api/conditions/sheet?weeks=6&limit=25[&recheck=1]  -> sheets to fetch
//   POST /api/conditions/sheet?editionId=…&url=…  <- the PDF bytes

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const weeks = Math.min(26, Math.max(1, Number(params.get('weeks') ?? 6)));
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') ?? 25)));
  const targets = await sheetTargets(weeks, limit, params.get('recheck') === '1');
  return NextResponse.json({ ok: true, weeks, count: targets.length, targets });
}

export async function POST(request: NextRequest) {
  const editionId = request.nextUrl.searchParams.get('editionId');
  const url = request.nextUrl.searchParams.get('url');
  if (!editionId || !/^[0-9a-f-]{36}$/i.test(editionId)) {
    return NextResponse.json({ ok: false, error: 'editionId (uuid) is required' }, { status: 400 });
  }
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length === 0) return NextResponse.json({ ok: false, error: 'Empty body' }, { status: 400 });

  // The ~2.6 KB "Tournament Information Not Yet Available" placeholder parses
  // to all-null, which still records the check so the edition is retried later.
  let sheet;
  try {
    sheet = parseSheetConditions(await extractRowText(buffer));
  } catch (error) {
    return NextResponse.json({ ok: false, error: `Not a readable PDF: ${error instanceof Error ? error.message : error}` }, { status: 422 });
  }
  await saveSheet(editionId, sheet, url);
  revalidateTag(CONDITIONS_CACHE_TAG);
  return NextResponse.json({ ok: true, editionId, bytes: buffer.length, ...sheet });
}

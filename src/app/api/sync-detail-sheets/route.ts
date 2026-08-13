import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { AUG17_ENTRY_LISTS } from '@/lib/aug17-entry-lists';
import {
  drawAddsUp,
  parseDetailSheetText,
  type DetailSheetDraw,
} from '@/lib/detail-sheet-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_START = '2026-08-17';
const SEASON = 2026;

const sheetUrl = (atpCode: string) =>
  `https://www.protennislive.com/posting/${SEASON}/${atpCode}/ds.pdf`;

type PdfTextItem = { str: string; transform: number[] };

/**
 * Text with the table rows intact.
 *
 * The draws table is only readable if cells that share a line stay on one line,
 * so items are grouped by their y coordinate and ordered by x. The default
 * reading order interleaves the columns and the table becomes unparseable.
 */
async function extractRowText(buffer: Buffer): Promise<string> {
  const pdfjsModule: unknown = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = pdfjsModule as {
    getDocument: (opts: {
      data: Uint8Array;
      isEvalSupported?: boolean;
      disableFontFace?: boolean;
      useSystemFonts?: boolean;
    }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
        }>;
        destroy: () => Promise<void>;
      }>;
    };
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;

  const lines: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<[number, string]>>();
      for (const raw of content.items) {
        const item = raw as Partial<PdfTextItem>;
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        if (!Array.isArray(item.transform) || item.transform.length < 6) continue;
        const y = Math.round(item.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y)?.push([item.transform[4], item.str]);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        lines.push(
          (rows.get(y) ?? [])
            .sort((a, b) => a[0] - b[0])
            .map(([, str]) => str)
            .join('\t')
        );
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return lines.join('\n');
}

async function storeDraw(atpCode: string, draw: DetailSheetDraw) {
  await pool.query(
    `insert into tournament_detail_sheets (
       week_start, atp_code, draw, draw_size, direct_acceptances, wild_cards,
       qualifiers, special_exempts, next_gen, prior_cutoff, raw_cells,
       source_url, adds_up, fetched_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     on conflict (week_start, atp_code, draw) do update
     set draw_size = excluded.draw_size,
         direct_acceptances = excluded.direct_acceptances,
         wild_cards = excluded.wild_cards,
         qualifiers = excluded.qualifiers,
         special_exempts = excluded.special_exempts,
         next_gen = excluded.next_gen,
         prior_cutoff = excluded.prior_cutoff,
         raw_cells = excluded.raw_cells,
         adds_up = excluded.adds_up,
         fetched_at = now()`,
    [
      WEEK_START,
      atpCode,
      draw.draw,
      draw.size,
      draw.directAcceptances,
      draw.wildCards,
      draw.qualifiers,
      draw.specialExempts,
      draw.nextGen,
      draw.priorCutoff,
      draw.raw,
      sheetUrl(atpCode),
      drawAddsUp(draw),
    ]
  );
}

/**
 * Read every Aug 17 event's posted detail sheet and store its draws table.
 *
 * This is the only source that states draw size per event, and it has to be per
 * event: the two Challenger 125s run a 28 main draw and a 16 qualifying, while
 * the 75s and 50s run 32 and 24. It also carries last season's cut for each
 * draw, which is the number this site exists to track.
 */
export async function GET(request: NextRequest) {
  const requestedWeek = request.nextUrl.searchParams.get('week') ?? WEEK_START;
  if (requestedWeek !== WEEK_START) {
    return NextResponse.json(
      { ok: false, error: `Detail-sheet sync is mapped for ${WEEK_START} only.` },
      { status: 400 }
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let stored = 0;

  for (const event of AUG17_ENTRY_LISTS) {
    const url = sheetUrl(event.atpCode);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; TennisTerminal/1.0; draw sizes)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const sheet = parseDetailSheetText(await extractRowText(buffer));

      // Refuse a partial overwrite: a sheet always states all three draws, so
      // fewer means the layout moved and the parse should not be trusted.
      if (sheet.draws.length < 3) {
        throw new Error(`parsed ${sheet.draws.length} draws, expected 3`);
      }

      for (const draw of sheet.draws) {
        await storeDraw(event.atpCode, draw);
        stored += 1;
      }

      results.push({
        slug: event.slug,
        atpCode: event.atpCode,
        level: sheet.level,
        draws: Object.fromEntries(
          sheet.draws.map((draw) => [
            draw.draw,
            {
              size: draw.size,
              da: draw.directAcceptances,
              wc: draw.wildCards,
              q: draw.qualifiers,
              priorCutoff: draw.priorCutoff,
              addsUp: drawAddsUp(draw),
            },
          ])
        ),
      });
    } catch (error) {
      results.push({
        slug: event.slug,
        atpCode: event.atpCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failures = results.filter((row) => 'error' in row).length;
  return NextResponse.json(
    { ok: failures === 0, week: WEEK_START, stored, failures, results },
    { status: failures === results.length ? 502 : 200 }
  );
}

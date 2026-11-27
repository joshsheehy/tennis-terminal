/**
 * Reads the official ATP singles ranking list that ProTennisLive publishes as a PDF
 * (posting/ramr/singles_entry_numerical.pdf). Only the current list is ever online.
 */
import type { PositionedText } from './draw-alternates';
import type { RankedPlayer } from './after-alts';

export type RankingList = { listDate: string; players: RankedPlayer[] };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function rowsOf(items: PositionedText[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedText[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - item.y) <= 2) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str.trim())
      .filter(Boolean)
      .join(' ')
  );
}

export function parseRankingPages(pages: PositionedText[][]): RankingList | null {
  let listDate: string | null = null;
  const players: RankedPlayer[] = [];
  for (const items of pages) {
    for (const row of rowsOf(items)) {
      const date = row.match(/Rankings Date:\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
      if (date) {
        const month = MONTHS.indexOf(date[1].toLowerCase()) + 1;
        if (month) listDate = `${date[3]}-${String(month).padStart(2, '0')}-${date[2].padStart(2, '0')}`;
        continue;
      }
      // "2312 T Holder, Carl (GBR) 1 0 0 …" — the country is blank for neutral athletes.
      const m = row.match(/^(\d{1,4})\s+(?:T\s+)?([^,\d][^,]*?),\s*(.*?)\s*(?:\(([A-Z]{3})\))?\s+[\d,]+(?:\s+[\d,]+){3,}$/);
      if (m) players.push([Number(m[1]), m[2].trim(), m[3].trim(), m[4] ?? '']);
    }
  }
  return listDate && players.length ? { listDate, players } : null;
}

export async function extractRankingList(buffer: Buffer): Promise<RankingList | null> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (opts: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }> }>;
        destroy: () => Promise<void>;
      }>;
    };
  };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;
  const pages: PositionedText[][] = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const content = await (await doc.getPage(p)).getTextContent();
      pages.push(
        content.items
          .filter((i) => typeof i.str === 'string' && i.str.trim() && i.transform)
          .map((i) => ({ str: i.str as string, x: (i.transform as number[])[4], y: (i.transform as number[])[5] }))
      );
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return parseRankingPages(pages);
}

// Text of a ProTennisLive PDF with its table rows intact: one line per row,
// cells joined by tabs. Shared by the detail-sheet draws sync and the
// conditions sync, which both read cells that sit side by side on a line.

type PdfTextItem = { str: string; transform: number[] };

export type PositionedText = { x: number; y: number; str: string };

// Cells of one table row can sit a fraction of a point apart: on Ankara's
// 2026 sheet "BALL:" is at y=898.4 and its value at y=898.5, which rounding
// to whole points put on different lines. Rows here are 8–12 points apart.
const SAME_ROW_POINTS = 2;

/** One tab-joined line per visual row, top to bottom, cells left to right. */
export function joinRows(items: PositionedText[]): string[] {
  const rows: Array<{ y: number; cells: PositionedText[] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1];
    if (row && row.y - item.y <= SAME_ROW_POINTS) row.cells.push(item);
    else rows.push({ y: item.y, cells: [item] });
  }
  return rows.map((row) =>
    row.cells
      .sort((a, b) => a.x - b.x)
      .map((cell) => cell.str)
      .join('\t')
  );
}

/**
 * Text with the table rows intact.
 *
 * The draws table is only readable if cells that share a line stay on one line,
 * so items are grouped by their y coordinate and ordered by x. The default
 * reading order interleaves the columns and the table becomes unparseable.
 */
export async function extractRowText(buffer: Buffer): Promise<string> {
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
      const items: PositionedText[] = [];
      for (const raw of content.items) {
        const item = raw as Partial<PdfTextItem>;
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        if (!Array.isArray(item.transform) || item.transform.length < 6) continue;
        items.push({ x: item.transform[4], y: item.transform[5], str: item.str });
      }
      lines.push(...joinRows(items));
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return lines.join('\n');
}

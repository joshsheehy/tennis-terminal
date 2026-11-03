// Text of a ProTennisLive PDF with its table rows intact: one line per row,
// cells joined by tabs. Shared by the detail-sheet draws sync and the
// conditions sync, which both read cells that sit side by side on a line.

type PdfTextItem = { str: string; transform: number[] };

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

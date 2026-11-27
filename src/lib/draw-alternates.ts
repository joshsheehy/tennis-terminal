/**
 * Who got into a draw as an alternate, read straight from the bracket of a ProTennisLive draw sheet.
 *
 * A bracket slot carries a status ("Alt") left of the player column: on the same row as the player in a
 * singles draw, and between the two partners in a doubles draw. Reading the bracket is more reliable than
 * the footer's "Alternates" box, which wraps long names and sometimes lists only the first few teams.
 */

export type PositionedText = { str: string; x: number; y: number };

export type Alternate = { surname: string; first: string; nat: string | null };

export type DrawAlternates = {
  event: 'singles' | 'doubles';
  /** Alt slots in the bracket: players in singles, teams in doubles. */
  count: number;
  /** One entry per slot: one player (singles) or two (doubles). */
  slots: Alternate[][];
  /** False when a slot's player(s) could not all be read. */
  complete: boolean;
};

const NAME_RE = /^(?:([A-Z]{3}) )?([A-ZÀ-ÞŁŠŽĆČĐ][A-ZÀ-ÞŁŠŽĆČĐ'’. -]*[A-ZÀ-ÞŁŠŽĆČĐ.]), ?(\S.*?)(?: ([A-Z]{3}))?$/;
const STATUS_RE = /^(?:\d{1,3}\s+)?(?:\d{1,2}\s+)?(?:WC\/)?Alt(?:\/WC)?(?:\s+\d{1,2})?$/i;
const FOOTER_RE = /last direct acceptance|^seeded (?:players|teams)\b/i;
const SAME_ROW = 3.5;
const PARTNER_REACH = 15;

type NameCell = Alternate & { x: number; y: number };

function nameCells(items: PositionedText[]): NameCell[] {
  const codes = items.filter((i) => /^[A-Z]{3}$/.test(i.str));
  const cells: NameCell[] = [];
  for (const item of items) {
    // A long surname is cut off before the comma ("VON DER SCHULENBUR…"): keep it, first name unknown.
    const cut = item.str.match(/^(?:([A-Z]{3}) )?([A-ZÀ-ÞŁŠŽĆČĐ][A-ZÀ-ÞŁŠŽĆČĐ'’. -]{7,}…)(?: ([A-Z]{3}))?$/);
    const m = item.str.match(NAME_RE) ?? (cut ? [cut[0], cut[1], cut[2], '', cut[3]] : null);
    if (!m) continue;
    const [, code, rest, first, after] = m;
    // "VAN ASSCHE" and "VON DER …" start with a surname particle, not a country code.
    const particle = code !== undefined && /^(VAN|VON|DEL|DER|DEN|DOS|DAS|SAN|MAC)$/.test(code);
    const before = particle ? undefined : code;
    const surname = particle ? `${code} ${rest}` : rest;
    // Template headers such as "CITY, COUNTRY" are not players: a first name has a lower-case letter.
    if (!cut && !/[a-zà-ÿ…]/.test(first)) continue;
    // The country sits just left (older sheets) or just right (current sheets) of the name.
    const near = codes
      .filter((c) => Math.abs(c.y - item.y) <= SAME_ROW && Math.abs(c.x - item.x) < 140)
      .sort((a, b) => Math.abs(a.x - item.x) - Math.abs(b.x - item.x))[0];
    cells.push({ surname: surname.trim(), first: first.trim(), nat: before ?? after ?? near?.str ?? null, x: item.x, y: item.y });
  }
  return cells;
}

/** Alt slots on one page. `items` use PDF coordinates (y grows upward). */
export function readPageAlternates(items: PositionedText[], event: 'singles' | 'doubles'): Alternate[][] {
  const clean = items.map((i) => ({ ...i, str: i.str.replace(/\s+/g, ' ').trim() })).filter((i) => i.str);
  const footerY = Math.max(-Infinity, ...clean.filter((i) => FOOTER_RE.test(i.str)).map((i) => i.y));
  const bracket = clean.filter((i) => i.y > footerY + 1);
  const names = nameCells(bracket);
  if (!names.length) return [];
  // The player column is where most names sit; stray "Surname, First"-shaped lines (a copyright notice)
  // appear elsewhere once or twice.
  const tally = new Map<number, number>();
  for (const n of names) tally.set(Math.round(n.x / 10), (tally.get(Math.round(n.x / 10)) ?? 0) + 1);
  const modal = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] * 10;
  const column = names.filter((n) => Math.abs(n.x - modal) < 45);
  const columnX = Math.min(...column.map((n) => n.x));
  const strip = ({ surname, first, nat }: NameCell): Alternate => ({ surname, first, nat });

  const slots: Alternate[][] = [];
  const statuses = bracket.filter((i) => STATUS_RE.test(i.str) && i.x < columnX + 5).sort((a, b) => b.y - a.y);
  for (const status of statuses) {
    const byDistance = column
      .map((n) => ({ n, dy: n.y - status.y }))
      .sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
    if (event === 'singles') {
      const hit = byDistance.find((c) => Math.abs(c.dy) <= 8);
      slots.push(hit ? [strip(hit.n)] : []);
      continue;
    }
    const pair = byDistance.filter((c) => Math.abs(c.dy) <= PARTNER_REACH).slice(0, 2);
    pair.sort((a, b) => b.dy - a.dy);
    slots.push(pair.map((c) => strip(c.n)));
  }
  return slots;
}

export function assembleAlternates(pages: PositionedText[][]): DrawAlternates {
  const event = pages.some((items) => items.some((i) => /\bdoubles\b/i.test(i.str))) ? 'doubles' : 'singles';
  const slots = pages.flatMap((items) => readPageAlternates(items, event));
  const size = event === 'singles' ? 1 : 2;
  return { event, count: slots.length, slots, complete: slots.every((s) => s.length === size) };
}

/** Reads a draw sheet PDF. Returns null when the PDF's text cannot be read at all. */
export async function extractDrawAlternates(buffer: Buffer): Promise<DrawAlternates | null> {
  try {
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
    return assembleAlternates(pages);
  } catch {
    return null;
  }
}

// Everything on a ProTennisLive detail sheet, kept for later use — hotel,
// contacts, sign-in deadlines, transport, practice courts, fees. Nothing here
// is shown on the site yet; it's an archive. The full row text is the record
// (a field this misses is still in it); the structured parts make it
// queryable. Pure, so it's testable without a database.

export type SheetContact = { role: string; details: string[] };

export type SheetCapture = {
  /** Every "Label: value" pair on the sheet; a label seen twice keeps both, joined by " | ". */
  fields: Record<string, string>;
  /** Lines that name a role (TOURNAMENT DIRECTOR, HOTEL RESERVATIONS…) with a phone or email. */
  contacts: SheetContact[];
  phones: string[];
  emails: string[];
  links: string[];
  /** The "Tournament Information Not Yet Available" stand-in — nothing worth keeping. */
  placeholder: boolean;
};

const PHONE = /\+\d[\d\s().-]{5,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LINK = /\b(?:https?:\/\/|www\.)[^\s\t]+/gi;
// "LAUNDRY COST:", "Primary Hotel:", "On-site Sign-In Deadlines - via Email or Text Message:"
const LABEL = /^[A-Za-z][A-Za-z0-9 '&/(),.+-]{0,70}:$/;
// "TOURNAMENT DIRECTOR", "PLAYERS' DESK", "ATP Supervisor"
const ROLE = /^[A-Z][A-Za-z' &/-]{2,40}$/;

const unique = (items: string[]) => Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));

function addField(fields: Record<string, string>, label: string, value: string) {
  const key = label.replace(/:$/, '').trim();
  if (!key || !value) return;
  fields[key] = fields[key] ? `${fields[key]} | ${value}` : value;
}

/** Structure what can be structured from a sheet's tab-joined row text (see pdf-row-text.ts). */
export function captureSheet(rowText: string): SheetCapture {
  const fields: Record<string, string> = {};
  const contacts: SheetContact[] = [];
  for (const line of rowText.split('\n')) {
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (LABEL.test(cell)) {
        const next = cells[i + 1];
        if (next && !LABEL.test(next)) addField(fields, cell, next);
        continue;
      }
      // "Breakfast: Included for all" in one cell; single letters ("T: +81…") are phones, kept below.
      const inline = /^([A-Za-z][A-Za-z0-9 '&/(),.+-]{1,40}):\s+(.+)$/.exec(cell);
      if (inline) addField(fields, inline[1], inline[2]);
    }
    if (cells.length > 1 && ROLE.test(cells[0]) && (PHONE.test(line) || EMAIL.test(line))) {
      contacts.push({ role: cells[0], details: cells.slice(1) });
    }
    PHONE.lastIndex = 0;
    EMAIL.lastIndex = 0;
  }
  return {
    fields,
    contacts,
    phones: unique(rowText.match(PHONE) ?? []),
    emails: unique(rowText.match(EMAIL) ?? []),
    links: unique(rowText.match(LINK) ?? []),
    placeholder: /Tournament Information Not Yet Available/i.test(rowText),
  };
}

// The text a person typed into a search box, as a literal ILIKE "contains"
// pattern: % and _ stop being wildcards. Returns null for anything too short
// to be worth a query. Kept apart from the database code so it's testable.
export function searchPattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (q.length < 2) return null;
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

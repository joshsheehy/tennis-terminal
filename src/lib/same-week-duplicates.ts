// Two editions of one event in one week. One city never hosts two ATP or
// Challenger events of the same level in the same week, so any such pair is a
// duplicate: the same tournament entered twice under two names.
//
// The names differ in ways a plain comparison misses. The 2027 calendar called
// the San Diego Open "San Diego 1, CA" while the Player Zone calendar called it
// "San Diego, CA"; neither contains the other, and the cities stored with them
// differed too, so the Monday audit's duplicate check never flagged it. So the
// place is compared with the event number, state code, bracketed venue and
// accents taken off, and taken from the name as well as the stored city.

export type WeekEdition = {
  edition_id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  year: number;
  week_start: string;
  start_date: string;
  level: string;
  source: string | null;
  cuts: number;
};

export type DuplicateGroup = {
  weekStart: string;
  level: string;
  place: string;
  editions: WeekEdition[];
};

/** "San Diego 1, CA" → "sandiego"; "Bogotá (Los Lagartos)" → "bogota"; "Tigre 2" → "tigre". */
export function placeKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,\s*[A-Z]{2}\s*$/, '')
    .replace(/\s+(?:\d{1,2}|i{1,3}|iv)\s*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Groups same-week, same-level editions that name the same place. ITF is left out: it runs several events a week in one city. */
export function findSameWeekDuplicates(editions: WeekEdition[]): DuplicateGroup[] {
  const buckets = new Map<string, Map<string, WeekEdition>>();
  for (const e of editions) {
    if (/^itf/i.test(e.level)) continue;
    const keys = new Set([placeKey(e.city), placeKey(e.name)].filter(Boolean));
    for (const key of keys) {
      const bucket = `${e.week_start}|${e.level}|${key}`;
      if (!buckets.has(bucket)) buckets.set(bucket, new Map());
      buckets.get(bucket)!.set(e.edition_id, e);
    }
  }

  // One pair can land in two buckets (by city and by name); report it once.
  const seen = new Set<string>();
  const groups: DuplicateGroup[] = [];
  for (const [bucket, members] of buckets) {
    if (members.size < 2) continue;
    const list = [...members.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    const id = list.map((e) => e.edition_id).sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const [weekStart, level, place] = bucket.split('|');
    groups.push({ weekStart, level, place, editions: list });
  }
  return groups.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.place.localeCompare(b.place));
}

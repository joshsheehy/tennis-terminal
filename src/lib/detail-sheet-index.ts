import { detailSheetUrl, levelGetsDetailSheet, resolveTournamentPtlCode } from './tournament-links';

// The index behind /ds: every tournament that has a ProTennisLive detail sheet,
// alphabetical, one row per tournament with a link for each year it ran.

export type DetailSheetEdition = {
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  year: number;
  level: string;
  source_url: string | null;
};

export type DetailSheetLink = { year: number; url: string };

export type DetailSheetEntry = {
  slug: string;
  name: string;
  place: string;
  level: string;
  code: string;
  sheets: DetailSheetLink[];
};

// Numeric so "Plovdiv 2" sorts before "Plovdiv 10"; base sensitivity so accents
// and case never decide the order.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

// "Tiburon, CA" -> "Tiburon", the same as the tournament page shows.
export function tournamentDisplayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '').trim();
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * @param editions every held edition (any level; non-ATP/Challenger ones are skipped)
 * @param snapshotUrls PDF links stored on cut snapshots. A calendar-discovered event often carries
 *   its ProTennisLive code only there, so they are searched too.
 */
export function buildDetailSheetIndex(
  editions: DetailSheetEdition[],
  snapshotUrls: Array<{ slug: string; url: string | null }> = []
): DetailSheetEntry[] {
  const bySlug = new Map<string, DetailSheetEdition[]>();
  for (const edition of editions) {
    if (!levelGetsDetailSheet(edition.level)) continue;
    const list = bySlug.get(edition.slug) ?? [];
    list.push(edition);
    bySlug.set(edition.slug, list);
  }

  const urlsBySlug = new Map<string, string[]>();
  for (const { slug, url } of snapshotUrls) {
    if (!url) continue;
    const list = urlsBySlug.get(slug) ?? [];
    list.push(url);
    urlsBySlug.set(slug, list);
  }

  const entries: DetailSheetEntry[] = [];
  for (const [slug, list] of bySlug) {
    const newestFirst = [...list].sort((a, b) => b.year - a.year);
    const newest = newestFirst[0];

    const code = resolveTournamentPtlCode(slug, [
      ...newestFirst.map((edition) => edition.source_url),
      ...(urlsBySlug.get(slug) ?? []),
    ]);
    if (!code) continue; // no code, so no sheet to link to

    const years = [...new Set(newestFirst.map((edition) => edition.year))];
    entries.push({
      slug,
      name: tournamentDisplayName(newest.name),
      place: [newest.city, newest.country].filter(Boolean).join(', '),
      level: newest.level,
      code,
      sheets: years.map((year) => ({ year, url: detailSheetUrl(code, year) })),
    });
  }

  return entries.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.slug, b.slug));
}

// Every word typed must appear somewhere in the name, place, level, slug or code.
export function filterDetailSheets(entries: DetailSheetEntry[], query: string): DetailSheetEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = fold(`${entry.name} ${entry.place} ${entry.level} ${entry.slug} ${entry.code}`);
    return words.every((word) => haystack.includes(word));
  });
}

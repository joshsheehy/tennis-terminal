// Grand Slam entry cuts, researched by hand from published entry/acceptance
// lists. Slams don't post acceptance lists on ProTennisLive (their posting
// URLs are placeholders or results-only draws), so these numbers can't come
// from the regular cut importer — each one here is backed by the source URL
// stored alongside it, and /api/import-slam-cuts upserts them (fill-only:
// an existing cut in the DB is never overwritten).
//
// Semantics match the rest of the site: `cut` is the LAST DIRECT ACCEPTANCE
// ranking on the official entry list at the entry deadline.
//
// Add new editions here as their entry lists are verified — one line per
// (slug, year, event, draw), and the nightly sync imports it.

export type SlamCutEntry = {
  /** Tournament slug: the main event for singles main / doubles, the
   * "<slam>-qualifying-<city>" event for singles qualifying. */
  slug: string;
  year: number;
  eventType: 'singles' | 'doubles';
  drawType: 'main' | 'qualifying';
  cut: number;
  /** URL of the published entry list / official article the number came from. */
  source: string;
  note?: string;
};

export const SLAM_CUTS: SlamCutEntry[] = [
  {
    slug: 'australian-open-melbourne',
    year: 2022,
    eventType: 'singles',
    drawType: 'main',
    cut: 108,
    source:
      'https://web.archive.org/web/20211208130647/https://tennisuptodate.com/atp/2022-australian-open-atp-entry-list-with-djokovic-medvedev-nadal',
    note: 'Original entry list at deadline (Dec 2021); last direct acceptance Sam Querrey, ranked 108.',
  },
  {
    slug: 'australian-open-melbourne',
    year: 2023,
    eventType: 'singles',
    drawType: 'main',
    cut: 100,
    source: 'https://ausopen.com/articles/news/australian-open-2023-main-draw-entry-lists-unveiled',
    note: 'Official AO entry-list announcement; lowest-ranked direct entrant Vasek Pospisil, ranked 100.',
  },
];

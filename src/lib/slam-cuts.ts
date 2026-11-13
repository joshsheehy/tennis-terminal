// Grand Slam entry cuts, researched by hand from official cut-off tables and
// published entry/acceptance lists. Slams don't post acceptance lists on
// ProTennisLive (their posting URLs are placeholders or results-only draws),
// so these numbers can't come from the regular cut importer. Each one here is
// backed by the source stored alongside it, and /api/import-slam-cuts upserts
// them (fill-only, except rows marked replaceExisting).
//
// Semantics: `cut` is the LAST DIRECT ACCEPTANCE ranking at the entry
// deadline: the "Original Cut Off" on an official acceptance list, which is
// what ATP PlayerZone's Cut-Offs table reports for the Slams. Doubles cuts are
// combined (joint) rankings, each player counting his better of singles or
// doubles ranking. The Slams publish no after-withdrawals cut, so there is no
// separate post-alternates number.
//
// Add new editions as they are verified. The nightly sync imports them.

export type SlamCutEntry = {
  /** Tournament slug: the main event for singles main / doubles, the
   * "<slam>-qualifying-<city>" event for singles qualifying. */
  slug: string;
  year: number;
  eventType: 'singles' | 'doubles';
  drawType: 'main' | 'qualifying';
  cut: number;
  /** URL of the cut-off table / published entry list the number came from. */
  source: string;
  note?: string;
  /** Overwrite a different cut already in the DB. Only for official sources
   * (PlayerZone, an official acceptance list): they supersede the rough
   * hand-entered numbers that filled these rows before. */
  replaceExisting?: boolean;
};

type Slam = 'AO' | 'RG' | 'WIM' | 'USO';

export const SLAM_SLUGS: Record<Slam, { main: string; qualifying: string }> = {
  AO: { main: 'australian-open-melbourne', qualifying: 'australian-open-qualifying-melbourne' },
  RG: { main: 'roland-garros-paris', qualifying: 'roland-garros-qualifying-paris' },
  WIM: { main: 'wimbledon-london', qualifying: 'wimbledon-qualifying-london' },
  USO: { main: 'us-open-new-york', qualifying: 'us-open-qualifying-new-york' },
};

// ATP PlayerZone > Tournaments > Cut-Offs (Tour tab), read 2026-11-12. Columns:
// MD singles, Q singles, MD doubles (advance). PlayerZone leaves the
// after-withdrawals columns empty for the Slams. The page offers 2023 onward,
// and its 2026 season was still blank when read.
export const PLAYERZONE_CUTOFFS_URL = 'https://www.atppz.com/tournaments/cut-offs';
const PLAYERZONE_CUTOFFS: Array<[Slam, number, number, number, number]> = [
  // slam, year, MD singles, Q singles, MD doubles
  ['AO', 2023, 98, 226, 149],
  ['RG', 2023, 97, 220, 150],
  ['WIM', 2023, 97, 221, 137],
  ['USO', 2023, 95, 221, 144],
  ['AO', 2024, 97, 228, 140],
  ['RG', 2024, 98, 220, 135],
  ['WIM', 2024, 98, 225, 129],
  ['USO', 2024, 98, 219, 135],
  ['AO', 2025, 98, 231, 160],
  ['RG', 2025, 100, 218, 145],
  ['WIM', 2025, 100, 225, 149],
  ['USO', 2025, 101, 225, 131],
];

const playerZoneEntries: SlamCutEntry[] = PLAYERZONE_CUTOFFS.flatMap(([slam, year, ms, qs, md]) => {
  const note = `ATP PlayerZone cut-offs table, ${year}: MD ${ms} / Q ${qs} / doubles ${md}.`;
  const base = { year, source: PLAYERZONE_CUTOFFS_URL, replaceExisting: true };
  return [
    { ...base, slug: SLAM_SLUGS[slam].main, eventType: 'singles', drawType: 'main', cut: ms, note },
    { ...base, slug: SLAM_SLUGS[slam].qualifying, eventType: 'singles', drawType: 'qualifying', cut: qs, note },
    { ...base, slug: SLAM_SLUGS[slam].main, eventType: 'doubles', drawType: 'main', cut: md, note },
  ] satisfies SlamCutEntry[];
});

// Editions PlayerZone doesn't cover (2022, and 2026 until it fills in), each
// verified against the published list it cites.
const otherEntries: SlamCutEntry[] = [
  {
    slug: SLAM_SLUGS.AO.main,
    year: 2022,
    eventType: 'singles',
    drawType: 'main',
    cut: 108,
    source:
      'https://web.archive.org/web/20211208130647/https://tennisuptodate.com/atp/2022-australian-open-atp-entry-list-with-djokovic-medvedev-nadal',
    note: 'Original entry list at deadline (Dec 2021); last direct acceptance Sam Querrey, ranked 108.',
  },
  {
    slug: SLAM_SLUGS.USO.main,
    year: 2022,
    eventType: 'singles',
    drawType: 'main',
    cut: 101,
    source:
      'https://www.usta.com/en/home/pro/pro-media---news/serena-in--u-s--leads-all-nations-in-initial-2022-us-open-single.html',
    note: 'USTA initial entry list (rankings of July 18, 2022): "The current cut-off in the men\'s field is No. 101".',
  },
  {
    slug: SLAM_SLUGS.WIM.qualifying,
    year: 2022,
    eventType: 'singles',
    drawType: 'qualifying',
    cut: 246,
    source: 'https://www.wimbledon.com/pdf/update/referees/2022/QS_Entries.pdf',
    note:
      'Rebuilt from the official final qualifying entry list (rank date 23/05/2022): its direct acceptances plus the withdraw list, re-sorted, 120 places. The same rebuild matches PlayerZone exactly for 2023 and 2025 and is within 4 for 2024.',
  },
  {
    slug: SLAM_SLUGS.AO.main,
    year: 2026,
    eventType: 'singles',
    drawType: 'main',
    cut: 101,
    source: 'https://www.puntodebreak.com/en/2025/12/09/here-are-the-great-surprises-of-the-entry-list-for-the-australian-open-2026',
    note: 'AO 2026 entry list on the 17 Nov 2025 rankings: last direct acceptance Thiago Tirante, No. 101.',
    replaceExisting: true,
  },
  {
    slug: SLAM_SLUGS.RG.qualifying,
    year: 2026,
    eventType: 'singles',
    drawType: 'qualifying',
    cut: 224,
    source:
      'https://www.tiebreaktennis.it/roland-garros-2026-la-entry-list-delle-qualificazioni-maschili-e-femminili/rg-2026-entry-list-q_m/',
    note: 'Official Player Acceptance List, Roland Garros Q (rankings date 4/27/2026): Original Cut Off 224, 119 direct acceptances.',
    replaceExisting: true,
  },
  {
    slug: SLAM_SLUGS.WIM.main,
    year: 2026,
    eventType: 'singles',
    drawType: 'main',
    cut: 103,
    source: 'https://www.wimbledon.com/pdf/update/referees/2026/MS_Entries.pdf',
    note:
      'Rebuilt from the official entry list (rank date 18/05/2026) plus its withdraw list: 104 places, last Luca Van Assche No. 103. Puntodebreak reported the same cut.',
    replaceExisting: true,
  },
  {
    slug: SLAM_SLUGS.WIM.qualifying,
    year: 2026,
    eventType: 'singles',
    drawType: 'qualifying',
    cut: 227,
    source: 'https://www.wimbledon.com/pdf/update/referees/2026/QS_Entries.pdf',
    note:
      'Rebuilt from the official final qualifying entry list (rank date 25/05/2026) plus its withdraw list, 119 places. The same rebuild matches PlayerZone exactly for 2023 and 2025 and is within 4 for 2024.',
  },
  {
    slug: SLAM_SLUGS.USO.main,
    year: 2026,
    eventType: 'singles',
    drawType: 'main',
    cut: 101,
    source: 'https://tennistourtalk.com/136078/2026-us-open-mens-and-womens-main-draw-singles-entry-lists',
    note: 'USTA entry lists of July 22, 2026 (rankings of July 20): men\'s cut-off No. 101, rounded out by Filip Misolic on a protected ranking of 101.',
    replaceExisting: true,
  },
];

export const SLAM_CUTS: SlamCutEntry[] = [...playerZoneEntries, ...otherEntries];

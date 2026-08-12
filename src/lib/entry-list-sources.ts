export type EntryListSourceTier =
  | 'official'
  | 'snapshot-mirror'
  | 'movement-feed'
  | 'tournament'
  | 'cross-check'
  | 'community';

export type EntryListSourceDefinition = {
  id: string;
  label: string;
  tier: EntryListSourceTier;
  priority: number;
  baseUrl: string;
  supports: Array<'main' | 'main-alternates' | 'qualifying' | 'qualifying-alternates' | 'movement'>;
  notes: string;
};

/**
 * Source priority for the entry-list product.
 *
 * A source may prove that a player moved, but movement must never rewrite the
 * immutable entry rank or original list order captured from the first verified
 * published snapshot.
 */
export const ENTRY_LIST_SOURCES: EntryListSourceDefinition[] = [
  {
    id: 'atp-protennislive',
    label: 'ATP ProTennisLive PlayerList',
    tier: 'official',
    priority: 100,
    baseUrl: 'https://api.protennislive.com/feeds/PlayerList/',
    supports: ['main', 'main-alternates', 'qualifying', 'qualifying-alternates', 'movement'],
    notes: 'Official structured source. Requires legitimately issued bearer access. Preserve API array order.',
  },
  {
    id: 'canal-tenis',
    label: 'Canal Tenis',
    tier: 'snapshot-mirror',
    priority: 80,
    baseUrl: 'https://canaltenis.com/',
    supports: ['main', 'main-alternates', 'qualifying'],
    notes: 'Useful independent frozen snapshot. Current Challenger pages expose MD alternates and Q acceptances, but not the deeper Q alternate queue.',
  },
  {
    id: 'ticktock-tennis',
    label: 'TickTock Tennis',
    tier: 'snapshot-mirror',
    priority: 78,
    baseUrl: 'https://entries.ticktocktennis.com/atp',
    supports: ['main', 'main-alternates', 'qualifying'],
    notes: 'Public list snapshot used as a reconciliation source; do not derive Q alternate order from MD next-in rows.',
  },
  {
    id: 'live-tennis',
    label: 'LiveTennis',
    tier: 'movement-feed',
    priority: 75,
    baseUrl: 'https://www.livetennis.it/',
    supports: ['main', 'main-alternates', 'qualifying', 'movement'],
    notes: 'Frequently publishes newer withdrawal/promotion updates. Treat article timestamp and source wording as provenance.',
  },
  {
    id: 'chq-updates',
    label: '@CHQ_Updates',
    tier: 'movement-feed',
    priority: 74,
    baseUrl: 'https://x.com/CHQ_Updates',
    supports: ['qualifying', 'qualifying-alternates', 'movement'],
    notes: 'Dedicated unofficial Challenger qualifying movement account. Parse explicit OUT / IN / Next updates; never infer unseen queue rows.',
  },
  {
    id: 'entry-lists',
    label: '@EntryLists',
    tier: 'movement-feed',
    priority: 72,
    baseUrl: 'https://x.com/EntryLists',
    supports: ['main', 'main-alternates', 'movement'],
    notes: 'Unofficial men’s entry-list withdrawal/update feed.',
  },
  {
    id: 'other-lists',
    label: '@OtherLists',
    tier: 'movement-feed',
    priority: 70,
    baseUrl: 'https://x.com/OtherLists',
    supports: ['qualifying', 'movement'],
    notes: 'Unofficial list update account; explicitly refers Challenger qualifying coverage to @CHQ_Updates.',
  },
  {
    id: 'darts-rankings',
    label: 'DartsRankings',
    tier: 'cross-check',
    priority: 65,
    baseUrl: 'https://www.dartsrankings.com/tennis/',
    supports: ['main', 'main-alternates', 'qualifying', 'qualifying-alternates', 'movement'],
    notes: 'Excellent historical reconstruction and cross-check. Keep Tennis Terminal provenance independent rather than copying derived state blindly.',
  },
  {
    id: 'tournament-site-social',
    label: 'Tournament website/social',
    tier: 'tournament',
    priority: 60,
    baseUrl: '',
    supports: ['main', 'qualifying', 'movement'],
    notes: 'Useful direct confirmation of withdrawals, wild cards and local/on-site changes when explicitly published.',
  },
  {
    id: 'community',
    label: 'Community corroboration',
    tier: 'community',
    priority: 20,
    baseUrl: '',
    supports: ['movement'],
    notes: 'Forum/fan reports are corroboration only and must not create a canonical queue without a stronger source.',
  },
];

export type Aug17SourceUrls = {
  canalTenis: string;
};

/** Predictable live snapshot URLs discovered for the Aug. 17, 2026 pilot. */
export const AUG17_ENTRY_SOURCE_URLS: Record<string, Aug17SourceUrls> = {
  cancun: {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-cancun-2026/',
  },
  'quebec-city': {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-quebec-2026/',
  },
  kingston: {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-kingston-2026/',
  },
  prague: {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-praga-2026/',
  },
  roehampton: {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-roehampton-2026/',
  },
  sion: {
    canalTenis: 'https://canaltenis.com/entry-list-atp-challenger-sion-2026/',
  },
};

export function sourceById(id: string): EntryListSourceDefinition | undefined {
  return ENTRY_LIST_SOURCES.find((source) => source.id === id);
}

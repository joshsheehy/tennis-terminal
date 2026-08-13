import {
  AUG17_ENTRY_LISTS,
  type Aug17EntryList,
  type EntryListPlayer,
} from './aug17-entry-lists';
import type { PublicEntryTournament } from './spazio-entry-list-parser';

export type TrackedEntryState = 'active' | 'withdrawn' | 'promoted-main' | 'removed-unknown';
export type MovementKind =
  | 'md-withdrawal'
  | 'md-alt-to-main'
  | 'q-to-main'
  | 'q-withdrawal'
  | 'q-alt-to-q'
  | 'q-alt-to-main'
  | 'q-alt-withdrawal'
  | 'removed-unknown';

export type TrackedEntryRow = EntryListPlayer & {
  originalPosition: number | null;
  originalLabel: string;
  effectivePosition: number | null;
  state: TrackedEntryState;
  statusLabel: string;
  detail?: string;
  sourceLabel?: string;
  /**
   * Entry code from the published list — WC, JR, SE, PR. It matters for display
   * because a wildcard's listed number is not an ATP ranking: the source gives
   * Kingston's junior wildcards ranks 11 and 19, which would read as top-20
   * players sitting in a Challenger 75.
   */
  entryCode?: string;
};

export type EntryMovementLedgerRow = {
  tournamentSlug: string;
  playerName: string;
  kind: MovementKind;
  fromSection: 'main' | 'main-alt' | 'qualifying' | 'qualifying-alt' | 'unknown';
  toSection: 'main' | 'qualifying' | 'out' | 'unknown';
  observedAt: string;
  sourceLabel: string;
  sourceUrl?: string;
  detail: string;
  qSpotsDelta: number;
};

export type TrackedAug17Event = Aug17EntryList & {
  mainHistory: TrackedEntryRow[];
  mainAltHistory: TrackedEntryRow[];
  qualifyingHistory: TrackedEntryRow[];
  movements: EntryMovementLedgerRow[];
};

const SPAZIO_URL =
  'https://www.spaziotennis.com/trn/ent/entry-list-atp-challenger-2026-week-33-cancun-quebec-city-kingston-praga-roehampton-sion/139834';

const PLAYERZONE_OBSERVED_AT = '2026-08-12T13:30:00-05:00';
const PUBLIC_OBSERVED_AT = '2026-08-11T12:54:00-05:00';

const key = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');

const player = (name: string, country: string, rank: number | null, note?: string): EntryListPlayer => ({
  name,
  country,
  rank,
  ...(note ? { note } : {}),
});

const STATUS: Record<string, Record<string, { state: TrackedEntryState; label: string; detail?: string; source?: string }>> = {
  cancun: {
    [key('Luciano Darderi')]: { state: 'withdrawn', label: 'OUT', detail: 'Main-draw withdrawal', source: 'SpazioTennis / LiveTennis' },
    [key('Henrique Rocha')]: { state: 'promoted-main', label: 'IN MD', detail: 'MD alternate promoted into main draw', source: 'SpazioTennis / LiveTennis' },
    [key('Arthur Gea')]: { state: 'removed-unknown', label: 'OUT', detail: 'Struck from MD alternate list; reason not verified', source: 'SpazioTennis' },
  },
  kingston: {
    [key('Bernard Tomic')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows row struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Liam Broady')]: { state: 'withdrawn', label: 'OUT', detail: 'Main-draw withdrawal', source: 'SpazioTennis / PlayerZone' },
    [key('Guido Ivan Justo')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows row struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Dan Added')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows row struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Franco Roncadelli')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows row struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Oliver Crawford')]: { state: 'promoted-main', label: 'IN MD', detail: 'MD ALT #1 promoted into main draw; earlier Q snapshot also placed him in qualifying', source: 'PlayerZone / SpazioTennis' },
    [key('Charles Broom')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows MD ALT #9 struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Yanki Erel')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows MD ALT #10 struck; reason not yet verified', source: 'PlayerZone screenshot' },
    [key('Philip Sekulic')]: { state: 'removed-unknown', label: 'OUT', detail: 'PlayerZone shows MD ALT #12 struck; reason not yet verified', source: 'PlayerZone screenshot' },
  },
  prague: {
    [key('Michele Ribecai')]: { state: 'withdrawn', label: 'OUT', detail: 'Main-draw withdrawal', source: 'SpazioTennis / LiveTennis' },
    [key('Miguel Damas')]: { state: 'promoted-main', label: 'IN MD', detail: 'MD alternate promoted into main draw', source: 'SpazioTennis / LiveTennis' },
  },
  roehampton: {
    [key('Hamish Stewart')]: { state: 'withdrawn', label: 'OUT', detail: 'Main-draw withdrawal', source: 'SpazioTennis / LiveTennis' },
    [key('Cyril Vandermeersch')]: { state: 'withdrawn', label: 'OUT', detail: 'Main-draw withdrawal', source: 'SpazioTennis / LiveTennis' },
    [key('Iliyan Radulov')]: { state: 'promoted-main', label: 'IN MD', detail: 'MD alternate promoted into main draw', source: 'SpazioTennis / LiveTennis' },
    [key('Luca Potenza')]: { state: 'promoted-main', label: 'IN MD', detail: 'Moved into main draw from the MD alternate/Q acceptance state, opening a Q vacancy', source: 'SpazioTennis + Aug 10 Q snapshot' },
    [key('Karim Bennani')]: { state: 'removed-unknown', label: 'OUT', detail: 'Struck from MD alternate list; reason not verified', source: 'SpazioTennis' },
  },
};

const EXTRA_MAIN: Record<string, Array<{ before: string; value: EntryListPlayer }>> = {
  cancun: [{ before: 'Juan Manuel Cerundolo', value: player('Luciano Darderi', 'ITA', 23) }],
  kingston: [{ before: 'Elias Ymer', value: player('Liam Broady', 'GBR', 202) }],
  prague: [{ before: 'Hynek Barton', value: player('Michele Ribecai', 'ITA', 267) }],
  roehampton: [
    { before: 'Michael Geerts', value: player('Hamish Stewart', 'GBR', 331) },
    { before: 'Adrian Boitan', value: player('Cyril Vandermeersch', 'FRA', 422) },
  ],
};

const EXTRA_ALT: Record<string, EntryListPlayer[]> = {
  cancun: [player('Henrique Rocha', 'POR', 123)],
  kingston: [
    player('Oliver Crawford', 'GBR', 228),
    player('Igor Marcondes', 'BRA', 296),
    player('Philip Sekulic', 'AUS', 301),
    player('Daniel Milavsky', 'USA', 325),
    player('Paul Jubb', 'GBR', 335),
    player('Tyler Zink', 'USA', 343),
    player('Blaise Bicknell', 'JAM', 344),
    player('Mitchell Krueger', 'USA', 346),
    player('Ivan Marrero Curbelo', 'ESP', 356),
  ],
  prague: [player('Miguel Damas', 'ESP', 289)],
  roehampton: [player('Iliyan Radulov', 'BUL', 441), player('Luca Potenza', 'ITA', 447)],
};

const EXTRA_Q: Record<string, EntryListPlayer[]> = {
  kingston: [player('Oliver Crawford', 'GBR', 228)],
  roehampton: [player('Luca Potenza', 'ITA', 447)],
};

function insertMissing(base: EntryListPlayer[], inserts: Array<{ before: string; value: EntryListPlayer }> = []) {
  const rows = [...base];
  for (const insert of inserts) {
    if (rows.some((item) => key(item.name) === key(insert.value.name))) continue;
    const index = rows.findIndex((item) => key(item.name) === key(insert.before));
    rows.splice(index >= 0 ? index : rows.length, 0, insert.value);
  }
  return rows;
}

function canonicalPlayer(event: Aug17EntryList, name: string, country: string | null, rank: number | null): EntryListPlayer {
  const candidates = [...event.main, ...event.mainNext, ...event.qualifying, ...(EXTRA_ALT[event.slug] ?? []), ...(EXTRA_Q[event.slug] ?? [])];
  const found = candidates.find((item) => key(item.name) === key(name));
  return found ?? player(name, country ?? '', rank);
}

/**
 * The live source wins over a seeded observation.
 *
 * STATUS holds hand-read PlayerZone/press observations from Aug 11-12, which
 * exist to fill gaps when the public list has not been parsed. They go stale:
 * Kingston's seed had Oliver Crawford promoted into the main draw, while the
 * source now marks him OUT. Reading the seed first kept him in the draw AND put
 * his replacement there too, so Kingston counted 22 acceptances where every
 * other event counted 21. The seed only speaks where the source is silent.
 */
function stateFor(slug: string, name: string, sourceMarker?: 'active' | 'in' | 'out' | 'struck') {
  if (sourceMarker === 'in') return { state: 'promoted-main' as const, label: 'IN MD', detail: 'Promoted into main draw', source: 'SpazioTennis' };
  if (sourceMarker === 'out') return { state: 'withdrawn' as const, label: 'OUT', detail: 'Source explicitly marks OUT', source: 'SpazioTennis' };
  if (sourceMarker === 'struck') return { state: 'removed-unknown' as const, label: 'OUT', detail: 'Source strikes row; reason not verified', source: 'SpazioTennis' };
  const seeded = STATUS[slug]?.[key(name)];
  if (seeded) return seeded;
  return { state: 'active' as const, label: 'ACTIVE' };
}

function trackedRows(
  slug: string,
  rows: EntryListPlayer[],
  prefix: 'MD' | 'ALT' | 'Q',
  markers?: Map<string, 'active' | 'in' | 'out' | 'struck'>,
  codes?: Map<string, string>
): TrackedEntryRow[] {
  const preliminary = rows.map((item, index) => {
    const status = stateFor(slug, item.name, markers?.get(key(item.name)));
    const code = codes?.get(key(item.name));
    return {
      ...item,
      originalPosition: index + 1,
      originalLabel: `${prefix} ${index + 1}`,
      effectivePosition: null,
      state: status.state,
      statusLabel: status.label,
      ...(status.detail ? { detail: status.detail } : {}),
      ...(status.source ? { sourceLabel: status.source } : {}),
      ...(code ? { entryCode: code } : {}),
    } satisfies TrackedEntryRow;
  });
  if (prefix !== 'ALT') return preliminary;
  let live = 0;
  return preliminary.map((row) => {
    if (row.state !== 'active') return row;
    live += 1;
    return { ...row, effectivePosition: live };
  });
}

function fallbackMain(event: Aug17EntryList): EntryListPlayer[] {
  const current = event.main.filter((item) => item.note !== 'IN');
  return insertMissing(current, EXTRA_MAIN[event.slug]);
}

function fallbackAlt(event: Aug17EntryList): EntryListPlayer[] {
  const extras = EXTRA_ALT[event.slug] ?? [];
  if (event.slug === 'kingston') {
    const ordered = [extras[0], ...event.mainNext, ...extras.slice(1)].filter(Boolean) as EntryListPlayer[];
    return Array.from(new Map(ordered.map((item) => [key(item.name), item])).values());
  }
  return Array.from(new Map([...extras, ...event.mainNext].map((item) => [key(item.name), item])).values());
}

function fallbackQ(event: Aug17EntryList): EntryListPlayer[] {
  const extras = EXTRA_Q[event.slug] ?? [];
  return Array.from(new Map([...extras, ...event.qualifying].map((item) => [key(item.name), item])).values());
}

function codeMap(rows: PublicEntryTournament['main']) {
  return new Map(
    rows.filter((row) => row.entryCode).map((row) => [key(row.name), row.entryCode as string] as const)
  );
}

function rowsFromPublic(event: Aug17EntryList, block: PublicEntryTournament | undefined) {
  if (!block) return null;
  const mainMarkers = new Map(block.main.map((row) => [key(row.name), row.marker] as const));
  const altMarkers = new Map(block.alternates.map((row) => [key(row.name), row.marker] as const));
  const mainBase = block.main.map((row) => canonicalPlayer(event, row.name, row.country, row.entryRank));
  const altBase = block.alternates.map((row) => canonicalPlayer(event, row.name, row.country, row.entryRank));
  return {
    mainBase,
    altBase,
    mainMarkers,
    altMarkers,
    mainCodes: codeMap(block.main),
    altCodes: codeMap(block.alternates),
  };
}

export const AUG17_SEEDED_MOVEMENTS: EntryMovementLedgerRow[] = [
  { tournamentSlug: 'cancun', playerName: 'Luciano Darderi', kind: 'md-withdrawal', fromSection: 'main', toSection: 'out', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD → OUT', qSpotsDelta: 0 },
  { tournamentSlug: 'cancun', playerName: 'Henrique Rocha', kind: 'md-alt-to-main', fromSection: 'main-alt', toSection: 'main', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD ALT → MD', qSpotsDelta: 0 },
  { tournamentSlug: 'kingston', playerName: 'Liam Broady', kind: 'md-withdrawal', fromSection: 'main', toSection: 'out', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / PlayerZone', sourceUrl: SPAZIO_URL, detail: 'MD → OUT', qSpotsDelta: 0 },
  { tournamentSlug: 'kingston', playerName: 'Oliver Crawford', kind: 'q-to-main', fromSection: 'qualifying', toSection: 'main', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'PlayerZone + Aug 10 Q snapshot', detail: 'Q / MD ALT #1 → MD', qSpotsDelta: 1 },
  { tournamentSlug: 'prague', playerName: 'Michele Ribecai', kind: 'md-withdrawal', fromSection: 'main', toSection: 'out', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD → OUT', qSpotsDelta: 0 },
  { tournamentSlug: 'prague', playerName: 'Miguel Damas', kind: 'md-alt-to-main', fromSection: 'main-alt', toSection: 'main', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD ALT → MD', qSpotsDelta: 0 },
  { tournamentSlug: 'roehampton', playerName: 'Hamish Stewart', kind: 'md-withdrawal', fromSection: 'main', toSection: 'out', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD → OUT', qSpotsDelta: 0 },
  { tournamentSlug: 'roehampton', playerName: 'Cyril Vandermeersch', kind: 'md-withdrawal', fromSection: 'main', toSection: 'out', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD → OUT', qSpotsDelta: 0 },
  { tournamentSlug: 'roehampton', playerName: 'Iliyan Radulov', kind: 'md-alt-to-main', fromSection: 'main-alt', toSection: 'main', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis / LiveTennis', sourceUrl: SPAZIO_URL, detail: 'MD ALT → MD', qSpotsDelta: 0 },
  { tournamentSlug: 'roehampton', playerName: 'Luca Potenza', kind: 'q-to-main', fromSection: 'qualifying', toSection: 'main', observedAt: PUBLIC_OBSERVED_AT, sourceLabel: 'SpazioTennis + Aug 10 Q snapshot', sourceUrl: SPAZIO_URL, detail: 'Q / MD ALT → MD', qSpotsDelta: 1 },
  ...['Bernard Tomic', 'Guido Ivan Justo', 'Dan Added', 'Franco Roncadelli'].map((playerName) => ({ tournamentSlug: 'kingston', playerName, kind: 'removed-unknown' as const, fromSection: 'main' as const, toSection: 'out' as const, observedAt: PLAYERZONE_OBSERVED_AT, sourceLabel: 'PlayerZone screenshot', detail: 'Row struck in current PlayerZone list; reason not yet verified', qSpotsDelta: 0 })),
  ...['Charles Broom', 'Yanki Erel', 'Philip Sekulic'].map((playerName) => ({ tournamentSlug: 'kingston', playerName, kind: 'removed-unknown' as const, fromSection: 'main-alt' as const, toSection: 'out' as const, observedAt: PLAYERZONE_OBSERVED_AT, sourceLabel: 'PlayerZone screenshot', detail: 'Alternate row struck in current PlayerZone list; reason not yet verified', qSpotsDelta: 0 })),
];

export function getTrackedAug17Events(publicTournaments: PublicEntryTournament[] = []): TrackedAug17Event[] {
  return AUG17_ENTRY_LISTS.map((event) => {
    const publicBlock = publicTournaments.find((item) => item.slug === event.slug);
    const publicRows = rowsFromPublic(event, publicBlock);
    const mainBase = publicRows?.mainBase ?? fallbackMain(event);
    const altBase = publicRows?.altBase.length ? publicRows.altBase : fallbackAlt(event);
    const mainHistory = trackedRows(event.slug, mainBase, 'MD', publicRows?.mainMarkers, publicRows?.mainCodes);
    const mainAltHistory = trackedRows(event.slug, altBase, 'ALT', publicRows?.altMarkers, publicRows?.altCodes);

    // A player accepted into qualifying who then leaves the event — promoted to
    // the main draw or withdrawn outright — must not still count as a live
    // qualifying acceptance. Whatever the alternate list says about them is the
    // more recent fact.
    const qBase = fallbackQ(event);
    const qualifyingHistory = trackedRows(event.slug, qBase, 'Q').map((row) => {
      const matchingAlt = mainAltHistory.find((alt) => key(alt.name) === key(row.name));
      if (!matchingAlt || matchingAlt.state === 'active') return row;
      return {
        ...row,
        state: matchingAlt.state,
        statusLabel: matchingAlt.statusLabel,
        detail:
          matchingAlt.state === 'promoted-main'
            ? 'Moved from Q into the main draw'
            : 'Left the event; no longer a qualifying acceptance',
        sourceLabel: matchingAlt.sourceLabel,
      };
    });

    // Promoted alternates join the main draw, but only once — a player the
    // source already lists in the main block is not added a second time.
    const inMain = new Set(mainHistory.map((row) => key(row.name)));
    const promotedMain = mainAltHistory
      .filter((row) => row.state === 'promoted-main' && !inMain.has(key(row.name)))
      .map((row) => ({ ...row, effectivePosition: null, originalLabel: `ALT ${row.originalPosition ?? '?'}` }));

    return {
      ...event,
      mainHistory: [...mainHistory, ...promotedMain],
      mainAltHistory,
      qualifyingHistory,
      movements: AUG17_SEEDED_MOVEMENTS.filter((movement) => movement.tournamentSlug === event.slug),
    };
  });
}

export function activeEventForPosition(event: TrackedAug17Event): Aug17EntryList {
  return {
    ...event,
    main: event.mainHistory
      .filter((row) => row.state === 'active' || row.state === 'promoted-main')
      .map(({ name, country, rank, note }) => ({ name, country, rank, ...(note ? { note } : {}) })),
    mainNext: event.mainAltHistory
      .filter((row) => row.state === 'active')
      .map(({ name, country, rank, note }) => ({ name, country, rank, ...(note ? { note } : {}) })),
    qualifying: event.qualifyingHistory
      .filter((row) => row.state === 'active')
      .map(({ name, country, rank, note }) => ({ name, country, rank, ...(note ? { note } : {}) })),
  };
}

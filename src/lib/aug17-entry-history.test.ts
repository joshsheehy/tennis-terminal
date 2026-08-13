import { describe, expect, it } from 'vitest';
import { getTrackedAug17Events } from './aug17-entry-history';
import type { PublicEntryRow, PublicEntryTournament } from './spazio-entry-list-parser';

const row = (
  name: string,
  entryRank: number,
  marker: PublicEntryRow['marker'] = 'active'
): PublicEntryRow => ({
  name,
  country: 'GBR',
  entryRank,
  entryCode: null,
  marker,
  rawText: `${name} GBR ${entryRank}`,
});

const kingston = (over: Partial<PublicEntryTournament> = {}): PublicEntryTournament[] => [
  {
    slug: 'kingston',
    sourceHeading: 'ENTRY LIST ATP CHALLENGER 75 KINGSTON',
    main: [row('Royer, Valentin', 78), row('Broady, Liam', 202, 'out')],
    alternates: [row('Clarke, Jay', 237, 'in')],
    ...over,
  },
];

const find = (tournaments: PublicEntryTournament[]) =>
  getTrackedAug17Events(tournaments).find((event) => event.slug === 'kingston')!;

const live = (rows: { state: string }[], main = false) =>
  rows.filter((r) => r.state === 'active' || (main && r.state === 'promoted-main')).length;

describe('getTrackedAug17Events', () => {
  it('replaces a withdrawal with a promotion, leaving the acceptance count unchanged', () => {
    const event = find(kingston());
    expect(live(event.mainHistory, true)).toBe(2);
    expect(event.mainHistory.some((r) => r.name.includes('Broady') && r.state === 'withdrawn')).toBe(true);
    expect(event.mainHistory.some((r) => r.name.includes('Clarke') && r.state === 'promoted-main')).toBe(true);
  });

  // Every Aug 17 event publishes exactly 21 main-draw acceptances, and each
  // departure is matched by a promotion. A player counted in both lists broke
  // that: Kingston reported 22 where the other five reported 21.
  it('never counts a promoted alternate twice when the source already lists them in the main draw', () => {
    const event = find(
      kingston({
        main: [row('Royer, Valentin', 78), row('Clarke, Jay', 237)],
        alternates: [row('Clarke, Jay', 237, 'in')],
      })
    );
    expect(event.mainHistory.filter((r) => r.name.includes('Clarke'))).toHaveLength(1);
    expect(live(event.mainHistory, true)).toBe(2);
  });

  it('lets the live source override a stale seeded observation', () => {
    // The seed has Oliver Crawford promoted into the Kingston main draw; the
    // source now marks him OUT, and the newer fact has to win.
    const event = find(kingston({ alternates: [row('Crawford, Oliver', 228, 'out')] }));
    const crawford = event.mainAltHistory.find((r) => r.name.includes('Crawford'));
    expect(crawford?.state).toBe('withdrawn');
    expect(event.mainHistory.some((r) => r.name.includes('Crawford'))).toBe(false);
  });

  it('drops a qualifying acceptance once the player has left the event', () => {
    const event = find(kingston({ alternates: [row('Crawford, Oliver', 228, 'out')] }));
    const inQ = event.qualifyingHistory.find((r) => r.name.includes('Crawford'));
    expect(inQ?.state).toBe('withdrawn');
  });

  it('carries the entry code through so a wildcard rank is not shown as a ranking', () => {
    const event = find(
      kingston({
        main: [{ ...row('Miguel, Guto', 11), country: 'BRA', entryCode: 'JR' }],
        alternates: [],
      })
    );
    expect(event.mainHistory[0].entryCode).toBe('JR');
  });
});

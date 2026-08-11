import { describe, expect, it } from 'vitest';
import { parseProTennisPlayerList } from './protennis-player-list';

describe('parseProTennisPlayerList', () => {
  it('preserves ATP published order and derives alternate queue positions from that order', () => {
    const parsed = parseProTennisPlayerList({
      Tour: 'ATP',
      TournamentYear: 2026,
      TournamentId: 3121,
      Tournaments: [{
        MainQualyDrawType: 'M',
        IsDoubles: false,
        PlayerListType: 'Acceptance',
        PlayerList: [
          { PlayerId: 'A001', FirstName: 'Main', LastName: 'One', NatlCode: 'USA', RankRoll: 178, EntryCode: null, Alternate: false },
          { PlayerId: 'A002', FirstName: 'Next Gen', LastName: 'Player', NatlCode: 'ITA', RankRoll: 184, EntryCode: 'NG', Alternate: false },
          { PlayerId: 'A003', FirstName: 'Alt', LastName: 'First', NatlCode: 'FRA', RankRoll: 185, Alternate: true },
          { PlayerId: 'A004', FirstName: 'Alt', LastName: 'Second', NatlCode: 'GBR', RankRoll: 181, Alternate: true },
        ],
      }],
    });

    expect(parsed.lists).toHaveLength(1);
    const list = parsed.lists[0];
    expect(list.eventType).toBe('singles');
    expect(list.drawType).toBe('main');
    expect(list.playerListType).toBe('Acceptance');
    expect(list.entries.map((entry) => entry.name)).toEqual([
      'Main One', 'Next Gen Player', 'Alt First', 'Alt Second',
    ]);
    expect(list.entries[2].alternatePosition).toBe(1);
    expect(list.entries[3].alternatePosition).toBe(2);
    // The lower-ranked numerical value must not reorder ATP's published queue.
    expect(list.entries[3].rank).toBe(181);
  });

  it('keeps main/qualifying and singles/doubles as separate lists', () => {
    const parsed = parseProTennisPlayerList({
      TournamentYear: 2026,
      TournamentId: 3009,
      Tournaments: [
        { MainQualyDrawType: 'M', IsDoubles: false, PlayerList: [{ FirstName: 'Singles', LastName: 'Main' }] },
        { MainQualyDrawType: 'Q', IsDoubles: false, PlayerList: [{ FirstName: 'Singles', LastName: 'Qualy' }] },
        { MainQualyDrawType: 'M', IsDoubles: true, PlayerList: [{ FirstName: 'Doubles', LastName: 'Main', PartnerId: 'P2' }] },
      ],
    });

    expect(parsed.lists.map(({ eventType, drawType }) => `${eventType}:${drawType}`)).toEqual([
      'singles:main',
      'singles:qualifying',
      'doubles:main',
    ]);
  });

  it('does not invent cutoff or ranking-date metadata that the ATP API does not provide', () => {
    const parsed = parseProTennisPlayerList({
      Tournaments: [{
        MainQualyDrawType: 'M',
        IsDoubles: false,
        PlayerList: [{ FirstName: 'Player', LastName: 'One', RankRoll: 500, Alternate: false }],
      }],
    });

    expect(parsed).not.toHaveProperty('originalCutoffRank');
    expect(parsed).not.toHaveProperty('rankingDate');
  });
});

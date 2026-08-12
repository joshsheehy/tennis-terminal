import { describe, expect, it } from 'vitest';
import {
  deriveEntryListState,
  entryListTrajectory,
  movementsFromParsedUpdate,
  parseEntryListMovementUpdate,
  type EntryListMovement,
  type EntryListSnapshot,
} from './entry-list-tracker';

const source = {
  label: 'test source',
  observedAt: '2026-08-11T12:00:00-05:00',
};

const snapshot: EntryListSnapshot = {
  tournamentSlug: 'example',
  draw: 'qualifying',
  phase: 'advance',
  rankingDate: '2026-07-29',
  publishedAt: '2026-07-29T12:00:00-04:00',
  source,
  entries: [
    {
      name: 'Accepted One',
      entryRank: 300,
      originalStatus: 'accepted',
      originalListPosition: 1,
      originalAlternatePosition: null,
    },
    {
      name: 'Accepted Two',
      entryRank: 350,
      originalStatus: 'accepted',
      originalListPosition: 2,
      originalAlternatePosition: null,
    },
    {
      name: 'Alternate One',
      entryRank: 410,
      originalStatus: 'alternate',
      originalListPosition: 3,
      originalAlternatePosition: 1,
    },
    {
      name: 'Alternate Two',
      entryRank: 425,
      originalStatus: 'alternate',
      originalListPosition: 4,
      originalAlternatePosition: 2,
    },
    {
      name: 'Alternate Three',
      entryRank: 450,
      originalStatus: 'alternate',
      originalListPosition: 5,
      originalAlternatePosition: 3,
    },
  ],
};

function movement(
  kind: EntryListMovement['kind'],
  playerName: string,
  observedAt: string
): EntryListMovement {
  return {
    tournamentSlug: 'example',
    draw: 'qualifying',
    phase: 'advance',
    kind,
    playerName,
    observedAt,
    source: { ...source, observedAt },
  };
}

describe('parseEntryListMovementUpdate', () => {
  it('parses OUT / IN / Next tracker syntax', () => {
    expect(
      parseEntryListMovementUpdate(
        'Mouilleron Qualifying update: OUT: Berankis, Castagnola IN: Dalmasso, Beauge Next: Nikles'
      )
    ).toEqual({
      out: ['Berankis', 'Castagnola'],
      in: ['Dalmasso', 'Beauge'],
      next: ['Nikles'],
    });
  });

  it('removes a group ALT note without changing the player name', () => {
    expect(
      parseEntryListMovementUpdate(
        'Skopje Qualifying update: OUT: Majchrzak IN: Ho, Zormann, Puttergill (ALTs)'
      ).in
    ).toEqual(['Ho', 'Zormann', 'Puttergill']);
  });
});

describe('deriveEntryListState', () => {
  it('never changes immutable entry rank or original alternate position', () => {
    const state = deriveEntryListState(snapshot, [
      movement('withdrawal', 'Accepted One', '2026-08-12T10:00:00-05:00'),
      movement('promotion', 'Alternate One', '2026-08-12T10:00:01-05:00'),
    ]);

    const promoted = state.rows.find((row) => row.name === 'Alternate One');
    expect(promoted?.entryRank).toBe(410);
    expect(promoted?.originalAlternatePosition).toBe(1);
    expect(promoted?.currentStatus).toBe('accepted');
  });

  it('compresses the remaining alternate queue after a promotion', () => {
    const state = deriveEntryListState(snapshot, [
      movement('promotion', 'Alternate One', '2026-08-12T10:00:00-05:00'),
    ]);

    expect(
      state.rows.find((row) => row.name === 'Alternate Two')?.currentAlternatePosition
    ).toBe(1);
    expect(
      state.rows.find((row) => row.name === 'Alternate Three')?.currentAlternatePosition
    ).toBe(2);
  });

  it('keeps unknown social-source names for review instead of inventing list rows', () => {
    const state = deriveEntryListState(snapshot, [
      movement('promotion', 'Unknown Player', '2026-08-12T10:00:00-05:00'),
    ]);
    expect(state.unmatchedMovements).toHaveLength(1);
    expect(state.rows).toHaveLength(snapshot.entries.length);
  });
});

describe('entryListTrajectory', () => {
  it('shows queue movement and final promotion without changing the frozen snapshot', () => {
    const changes = [
      movement('promotion', 'Alternate One', '2026-08-12T10:00:00-05:00'),
      movement('promotion', 'Alternate Two', '2026-08-12T11:00:00-05:00'),
      movement('promotion', 'Alternate Three', '2026-08-12T12:00:00-05:00'),
    ];

    expect(entryListTrajectory(snapshot, changes, 'Alternate Three')).toEqual([
      'Q ALT 3',
      'Q ALT 2',
      'Q ALT 1',
      'Q IN',
    ]);
  });
});

describe('movementsFromParsedUpdate', () => {
  it('turns parsed source text into auditable movement events', () => {
    const rawText = 'OUT: Accepted One IN: Alternate One Next: Alternate Two';
    const parsed = parseEntryListMovementUpdate(rawText);
    const movements = movementsFromParsedUpdate(parsed, {
      tournamentSlug: 'example',
      draw: 'qualifying',
      phase: 'advance',
      observedAt: '2026-08-12T10:00:00-05:00',
      source,
      rawText,
    });

    expect(movements.map((item) => item.kind)).toEqual([
      'withdrawal',
      'promotion',
      'reported-next',
    ]);
  });
});

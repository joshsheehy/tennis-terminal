// Tournaments whose surface the importers keep getting wrong.
//
// Every importer takes a surface from its own source and falls back to "Hard" when the source
// has none, and several re-run on a schedule, so correcting a row by hand does not last. Like
// tournament-aliases.ts, this is re-applied every night by /api/resolve-tournament-aliases
// (already wired into both nightly workflows), and it covers EVERY year of the tournament.
//
// ADDING ONE: when you know a tournament is always played on one surface, add it here rather
// than editing the rows.

export type SurfaceOverride = {
  slug: string;
  surface: 'Clay' | 'Hard' | 'Indoor Hard' | 'Grass';
  indoor: boolean;
  reason: string;
};

export const SURFACE_OVERRIDES: SurfaceOverride[] = [
  {
    slug: 'hamburg',
    surface: 'Clay',
    indoor: false,
    reason:
      'Every Hamburg event is played on clay. This is the Challenger that shares its name with the ' +
      'ATP 500 (Bitpanda Hamburg Open); its earlier editions came in from a source as hard court.',
  },
];

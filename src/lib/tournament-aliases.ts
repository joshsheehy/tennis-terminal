// Registry of known duplicate slugs that a specific data source keeps
// recreating under an alternate spelling of a tournament that already has a
// canonical row.
//
// WHY THIS EXISTS: three importers (import-challenger-season, sync-atp-
// schedule, import-atp-schedule) each independently derive a tournament's
// slug from whatever name their own source text gives them, and only skip
// that if they can match the row to the static catalogue by PROTENNISLIVE
// CODE first. A tournament discovered under a name the catalogue doesn't
// carry a code for — or that a source's code lookup misses for its own
// reasons — falls straight through to "slugify this text," with no
// cross-check against tournaments the DB already has under a different
// spelling.
//
// /api/dedupe-by-code cleans up the case where two such rows DO share a code
// (that's how the Fujairah Open/Fujairah 1 duplicate resolved itself
// overnight, unprompted). It has nothing to work with when the duplicate has
// no code at all — which is exactly the shape of this bug: "Mouilleron-le-
// Captif" (the ATP archive's and JeffSackmann's name for the venue) kept
// recreating itself under its own slug, night after night, because it never
// carried the code that would let dedupe-by-code find it. A one-off
// /api/merge-tournaments run fixes the state for a day; the next sync
// recreates the ghost from the same source text.
//
// So: record the alias once, and /api/resolve-tournament-aliases (wired into
// both nightly workflows, after everything that could have recreated one)
// merges it back into the canonical row every time, the same way
// cancelled-editions.ts's sweep re-applies a cancellation every night rather
// than trusting a one-time database edit to stick.
//
// ADDING ONE: when a merge-tournaments run fixes a duplicate today and you
// have reason to think the same source will recreate it (no shared code, or
// it already came back once), add it here instead of just merging by hand.

export type TournamentAlias = {
  /** The duplicate slug a source keeps generating. */
  aliasSlug: string;
  /** The slug carrying the tournament's real history — merges land here. */
  canonicalSlug: string;
  reason: string;
};

export const TOURNAMENT_ALIASES: TournamentAlias[] = [
  {
    aliasSlug: 'mouilleron-le-captif',
    canonicalSlug: 'open-de-vendee',
    reason:
      'The ATP results archive and JeffSackmann both name the venue rather than the event ' +
      '("Mouilleron-le-Captif" / "Mouilleron le Captif") while the official calendar and ' +
      'ProTennisLive call it "Open de Vendée". No shared code to catch it via dedupe-by-code, ' +
      'so it recreates itself under this slug on the next sync unless resolved here.',
  },
];

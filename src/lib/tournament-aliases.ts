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
  {
    aliasSlug: 'plovdiv-challenger',
    canonicalSlug: 'plovdiv',
    reason:
      'The 22 June 2026 Plovdiv Challenger was created twice. It is played on clay, which is what ' +
      '"plovdiv" has; "plovdiv-challenger" carried it as a hard court, and held the imported cuts. ' +
      'Merging into "plovdiv" keeps the clay edition and folds those cuts into it.',
  },
  {
    aliasSlug: 'florianopolis',
    canonicalSlug: 'engie-open',
    reason:
      'Same Florianópolis Challenger under its city name and its sponsor name. "engie-open" carries ' +
      'the history (2022-2025, with cuts); "florianopolis" only the 2026 edition.',
  },
  {
    aliasSlug: 'san-gregorio-di-catania',
    canonicalSlug: 'catania',
    reason:
      'Same Catania Challenger (12 October 2026) under the town it is played in and the city name. ' +
      'Neither has history, so the shorter, city-named slug is canonical.',
  },
  {
    aliasSlug: 'la-paz-1',
    canonicalSlug: 'la-paz',
    reason:
      'Same La Paz Challenger (7 December 2026, 2026 week 49) under two ' +
      'names from two different revisions of the official combined calendar PDF (2026-09-10 called ' +
      'it "La Paz"; 2026-09-18, after a second La Paz event was added to the calendar, called it ' +
      '"La Paz 1" to disambiguate). No shared code to catch it via dedupe-by-code, so a one-off ' +
      'merge-tournaments run on 2026-10-06 recreated itself by 2026-10-12 on the next calendar sync.',
  },
  {
    aliasSlug: 'chisinau-1',
    canonicalSlug: 'chisinau-chisinau',
    reason:
      'Same Chișinău Challenger 100 (25 May 2026): the official calendar calls it "Chisinau 1" (a ' +
      'second Chisinau, "Chisinau 2", is 30 Nov and stays separate as chisinau-2) while the catalogue ' +
      'calls it "Chișinău". dedupe-by-code only caught it on nights chisinau-1 had picked up a code, ' +
      'so it sat on the schedule twice in between.',
  },
  // The 2027 official calendar (atppz PDF of 2026-11-03) names three January
  // events differently from the Player Zone calendar they were first entered
  // from, and neither name is in the catalogue, so the PDF sync created a
  // second tournament for each, in the same week as the first.
  {
    aliasSlug: 'san-diego-1',
    canonicalSlug: 'san-diego-ca-san-diego',
    reason:
      'The San Diego Open (ProTennisLive 2971; 2025, 2026 history) is "San Diego 1, CA" on the 2027 ' +
      'calendar, 18 January, because a second San Diego event ("San Diego 2, CA", 25 January) follows ' +
      'it. Both San Diego Open rows sat in the week of 18 January 2027.',
  },
  {
    aliasSlug: 'bengaluru',
    canonicalSlug: 'bengaluru-1-bengaluru',
    reason:
      'The Bengaluru Open (ProTennisLive 7808, week 1 every year) is "Bengaluru" on the 2027 calendar ' +
      'and "Bengaluru 1" on the 2026 one. Both rows sat in the week of 4 January 2027.',
  },
  {
    aliasSlug: 'tigre',
    canonicalSlug: 'tigre-1-tigre',
    reason:
      'The Challenger de Tigre is "Tigre" on the 2027 calendar (11 January) and "Tigre 1" on the 2026 ' +
      'one (ProTennisLive 9678). Both rows sat in the week of 11 January 2027. A second Tigre event ' +
      'that season would arrive as "Tigre 2" and stay separate.',
  },
  {
    aliasSlug: 'open-quimper-bretagne-occidentale',
    canonicalSlug: 'quimper-quimper',
    reason:
      'The 2023 Quimper Challenger 125 (24-29 January) under its sponsor name, posted on ' +
      'ProTennisLive under a second code (8003) beside the usual 6239; both sheets are the same ' +
      'event and carried identical cuts. quimper-quimper holds 2022-2027.',
  },
];

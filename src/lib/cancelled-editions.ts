// Registry of individual editions that were cancelled mid-season — the
// tournament still exists in general, but a specific year didn't run. Distinct
// from discontinued-tournaments.ts (which covers permanently-ended events).
//
// Each entry hides exactly one (slug pattern, year). The sweep runs inside
// sync-canonical and matches via ILIKE on tournament name, slug, or city —
// loose enough to catch automated-importer variants like a bare "durham"
// slug alongside the canonical "durham-nc-durham". Cuts attached to the
// hidden row stay in the DB but the row disappears from the schedule.
//
// Add new rows here when an event is cancelled and you want it to stay
// hidden across future re-syncs.

export type CancelledEdition = {
  /** ILIKE pattern matched against tournament name, slug, or city. */
  pattern: string;
  /** Single year the cancellation applies to. */
  year: number;
  reason: string;
};

// The rows below are confirmed against the official ATP combined calendar PDF
// (rsc.atppz.com/.../2026/20260910_2026_combined_calendar.pdf, published
// 09/09/2026) — every one carries the literal word "Cancelled" in its own
// calendar row, not an inference from a missing draw sheet. That distinction
// matters: sync-official-calendar already skips a "Cancelled" row on import
// (see the notes check in that route), which is exactly why events cancelled
// BEFORE their first sync never reach the database at all. These are the
// opposite case — events that were in the database (from the static catalogue,
// or from JeffSackmann, or from an earlier calendar snapshot) before ATP
// marked them cancelled, so nothing removes the stale 'held' row on its own.
//
// Fujairah 1 is the one entry with real cut data attached despite being
// cancelled: its entry list was published (real players, real rankings)
// before the tournament itself was called off — consistent with the public
// record that it ran 2-3 March before being cancelled. The sweep does not
// special-case that; the data stays in the DB, only the status flips.
export const CANCELLED_EDITIONS: CancelledEdition[] = [
  {
    pattern: 'durham',
    year: 2026,
    reason:
      'Cancelled before play; dropped from the official ATP Challenger calendar. Tournament may return in 2027.',
  },
  {
    pattern: 'fujairah',
    year: 2026,
    reason:
      'Both Fujairah 1 (2-8 Mar) and Fujairah 2 (9-15 Mar) cancelled — reported due to regional safety concerns. ' +
      'Fujairah 1 had a published entry list (real acceptance data, PTL code 3067) before cancellation; ' +
      'that data stays attached to the row, only its status changes.',
  },
  {
    pattern: 'centurion-3',
    year: 2026,
    reason: 'Centurion 3 (27 Jul) cancelled. Centurion 1 and 2 ran as scheduled; see next entry for Centurion 4.',
  },
  {
    pattern: 'centurion-4',
    year: 2026,
    reason: 'Centurion 4 (3 Aug) cancelled. Centurion 1 and 2 ran as scheduled.',
  },
  {
    pattern: 'manta',
    year: 2026,
    reason: 'Cancelled — also matches public reporting that the 2026 revival of the Manta Open fell through.',
  },
  {
    pattern: 'tashkent',
    year: 2026,
    reason: 'Cancelled. Pattern is Challenger-only (ITF level excluded by the sweep below) — do not touch the M15 Tashkent editions.',
  },
  {
    pattern: 'girona',
    year: 2026,
    reason: 'Cancelled (23 Mar).',
  },
  {
    pattern: 'merida',
    year: 2026,
    reason: 'Cancelled (13 Apr).',
  },
  {
    pattern: 'gaborone',
    year: 2026,
    reason: 'Cancelled (26 Oct, per the calendar snapshot — confirm again closer to the date in case it is reinstated). ITF-level excluded by the sweep below.',
  },
];

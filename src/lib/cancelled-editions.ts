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

export const CANCELLED_EDITIONS: CancelledEdition[] = [
  {
    pattern: 'durham',
    year: 2026,
    reason:
      'Cancelled before play; dropped from the official ATP Challenger calendar. Tournament may return in 2027.',
  },
];

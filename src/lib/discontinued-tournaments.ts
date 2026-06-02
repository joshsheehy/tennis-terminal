// Registry of tournaments that have permanently ended. Any held edition for
// these slugs in a year after `finalYear` is treated as stale data — usually
// from an automated importer that hasn't been updated yet, or from a
// JeffSackmann backfill that carried the slug forward into post-discontinuation
// years.
//
// Add new rows here when a tournament drops off the calendar. The sweep is
// run by sync-canonical and exposed standalone via
// /api/cleanup-2026-stale-atp, so any year > finalYear gets marked
// status='not_held' on the next sync — cuts attached to those rows stay in
// the DB but the rows disappear from the schedule.
//
// Pattern matching is intentionally loose (ILIKE '%pattern%' on either
// tournament name or slug) so older imports with non-canonical slugs are
// caught. Rows with cuts attached are preserved by the sweep; only the
// status flips.

export type DiscontinuedTournament = {
  /** ILIKE pattern matched against both tournament name and slug. */
  pattern: string;
  /** Last year the tournament actually took place. */
  finalYear: number;
  /** Optional: documentation pointer to the successor event. */
  replacedBy?: string;
  /** Human-readable rationale, surfaced in API responses for traceability. */
  reason: string;
};

export const DISCONTINUED_TOURNAMENTS: DiscontinuedTournament[] = [
  {
    pattern: 'zhuhai',
    finalYear: 2023,
    replacedBy: 'hangzhou-open-hangzhou',
    reason:
      'Zhuhai Championships ran 2019–2023 and was replaced by the Hangzhou Open starting with the 2024 season (Wikipedia). Any held Zhuhai edition in 2024+ is stale.',
  },
];

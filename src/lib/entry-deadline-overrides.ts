// Hand-verified exceptions to the standard day-counts in entry-deadlines.ts.
//
// WHY THIS FILE EXISTS
//
// The 2026 ATP Official Rulebook (docs/sources/atp-rulebook-2026-ch1-circuit-
// regulations.pdf, §1.02) reserves ATP's right to run a different schedule
// for Challengers "scheduled prior to Grand Slam tournaments and ATP Masters
// 1000", and separately (§7.03 D, docs/sources/atp-rulebook-2026-ch7-the-
// competition.pdf) ATP "may extend the deadline for entries and/or
// withdrawals when unforeseen circumstances arise". Neither clause gives a
// formula — no fixed day count, no list of which weeks, nothing a script
// could compute from the calendar alone. The actual shift, when it happens,
// is ATP's own discretionary call, communicated only on the affected
// tournaments' own detail sheets (ds.pdf).
//
// So this is a small, hand-verified list, the same shape as ptl-code-
// overrides.ts, surface-overrides.ts and tournament-aliases.ts — not a guess
// at scale. A wrong shift would tell a subscriber entries close on a date
// they don't, which is worse than not knowing about the shift at all.
//
// WHAT'S CONFIRMED SO FAR
//
// Challenger week of 2026-10-05 — the week immediately before the Shanghai
// Masters 1000 (2026-10-07 to 2026-10-18): Palermo (code 3153) and Wuning 3
// (code 3183) both carry a Doubles Advance Entry deadline of Wednesday
// 2026-09-30 on their real detail sheets, not the standard Monday 2026-09-28
// (7 days prior) — 2 days later. Their singles main/qualifying deadlines were
// NOT shifted. Two independent, unrelated tournaments landing on the exact
// same non-standard date in the same week is not a coincidence; read as one
// week-level decision, not two tournament-specific ones.
//
// Fort Worth (week of 2026-10-19, the week immediately after Shanghai ends)
// shows a different-shaped shift on its own detail sheet — singles main
// moved from Monday 2026-09-28 to Wednesday 2026-09-30 (21 days -> 19 days),
// singles qualifying from Wednesday 2026-09-30 to Thursday 2026-10-01 (19 ->
// 18 days, breaking the usual exact 2-day gap between the two), and doubles
// NOT shifted at all. That's inconsistent enough with Palermo/Wuning 3's
// clean pattern that it reads as a separate, individually-granted extension
// (Fort Worth's own draw was still unposted weeks after it should have been —
// see the "Fall back to the detail sheet" commit) rather than the same
// Masters-adjacency rule. Recorded anyway, because the app's job is to tell
// a Fort Worth subscriber the real deadline, whichever reason produced it.
//
// This is not exhaustive. Masters 1000s and Grand Slams recur all year
// (9 Masters 1000s + 4 Slams in 2026), and the Rulebook's own wording implies
// some of their adjacent Challenger weeks get the same treatment — but each
// one needs its own detail-sheet check before it goes in this file. See
// scan-ptl-season.mjs's parseDetailSheetHeader for how to fetch and read one,
// or just open https://www.protennislive.com/posting/<year>/<code>/ds.pdf.
//
// ADDING ONE
//
// Confirm against the tournament's real ds.pdf (the "ENTRY & SIGN-IN
// DEADLINES" section), not a guess from the calendar. If a week has more than
// one Challenger, check at least two of them — a shift that shows up on only
// one of several tournaments in the same week is that tournament's own
// extension, not a week-level rule, and still worth recording, but say so.

export type DeadlineOverrideKind = 'main' | 'qualifying' | 'doubles';

type Override = {
  slug: string;
  year: number;
  kind: DeadlineOverrideKind;
  /** YYYY-MM-DD the deadline actually falls on, per the tournament's own detail sheet. */
  deadlineDate: string;
  reason: string;
};

const OVERRIDES: Override[] = [
  {
    slug: 'palermo',
    year: 2026,
    kind: 'doubles',
    deadlineDate: '2026-09-30',
    reason: 'Week before the Shanghai Masters 1000; confirmed on the tournament’s own ds.pdf.',
  },
  {
    slug: 'wuning-3',
    year: 2026,
    kind: 'doubles',
    deadlineDate: '2026-09-30',
    reason: 'Week before the Shanghai Masters 1000; confirmed on the tournament’s own ds.pdf.',
  },
  {
    slug: 'fort-worth',
    year: 2026,
    kind: 'main',
    deadlineDate: '2026-09-30',
    reason: 'Confirmed on the tournament’s own ds.pdf; shift pattern differs from Palermo/Wuning 3 (see file header) — likely its own extension, not the Masters-adjacency rule.',
  },
  {
    slug: 'fort-worth',
    year: 2026,
    kind: 'qualifying',
    deadlineDate: '2026-10-01',
    reason: 'Confirmed on the tournament’s own ds.pdf; see the main-draw entry above.',
  },
];

const BY_KEY = new Map<string, Override>(OVERRIDES.map((o) => [`${o.slug}@${o.year}|${o.kind}`, o]));

/** The real deadline date for a tournament/kind, if a hand-verified override exists; null otherwise. */
export function deadlineOverrideFor(slug: string, year: number, kind: DeadlineOverrideKind): string | null {
  return BY_KEY.get(`${slug}@${year}|${kind}`)?.deadlineDate ?? null;
}

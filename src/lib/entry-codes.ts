// Entry codes on an ATP acceptance list, and what the number beside them means.
//
// A published entry list is not a ranking list. Alongside direct acceptances it
// carries wildcards, protected rankings and the three PIF ATP Next Gen
// Accelerator pathways, and the accelerator pathways are the reason a
// Challenger main draw can show a player at "11".
//
// The three pathways, and the ranking each is drawn from:
//
//   NG  Next Gen Accelerator, professional pathway. Players aged 20 and under
//       inside the top 500 of the PIF ATP Rankings. Eight main-draw spots at
//       Challenger 50/75; eight main-draw or qualifying spots at Challenger
//       100/125. The number IS an ATP ranking.
//   JR  Junior Accelerator. Top 20 of the ITF Junior World Rankings, eight
//       main-draw or qualifying opportunities, Challenger 50/75 only. The
//       number is an ITF JUNIOR ranking.
//   CO  College Accelerator. Top 20 of the ITA collegiate rankings, eight
//       main-draw or qualifying opportunities, Challenger 50/75 only. The
//       number is an ITA COLLEGIATE ranking.
//
// The Aug 17 week bears all of this out: NG appears only at the two Challenger
// 125s (Kouame 213, Blanch 226, Budkov Kjaer 144, Sakamoto 166 — all plausible
// ATP rankings), while JR and CO appear only at the 75s and 50s and never above
// 20 (Vasami 2, Ivanov 7, Dahlin 9, Badenhorst 10, Miguel 11, Willwerth 19).
//
// Sources:
//   https://www.nextgenatpfinals.com/en/news/pif-atp-next-gen-accelerator-2026-explainer
//   https://www.atptour.com/en/news/pif-atp-next-gen-accelerator-2026-explainer

export type EntryCode = 'NG' | 'JR' | 'CO' | 'WC' | 'SE' | 'PR' | 'Q' | 'ALT';

const LABELS: Record<EntryCode, string> = {
  NG: 'Next Gen Accelerator',
  JR: 'Junior Accelerator — number is an ITF junior ranking',
  CO: 'College Accelerator — number is an ITA collegiate ranking',
  WC: 'Wild card',
  SE: 'Special exempt',
  PR: 'Protected ranking',
  Q: 'Qualifier',
  ALT: 'Alternate',
};

/**
 * Codes whose listed number comes from a different ranking system, so it must
 * never be shown as though it were an ATP ranking. A junior at 11 and a player
 * at ATP 11 are not remotely the same thing.
 */
const FOREIGN_RANKING: ReadonlySet<string> = new Set<EntryCode>(['JR', 'CO']);

export function normalizeEntryCode(code: string | null | undefined): EntryCode | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return upper in LABELS ? (upper as EntryCode) : null;
}

export function entryCodeLabel(code: string | null | undefined): string | null {
  const known = normalizeEntryCode(code);
  return known ? LABELS[known] : null;
}

/** True when the number published beside this code is an ATP ranking. */
export function numberIsAtpRanking(code: string | null | undefined): boolean {
  const known = normalizeEntryCode(code);
  return known === null || !FOREIGN_RANKING.has(known);
}

/**
 * What to print in the ranking column.
 *
 * Where the number is a junior or collegiate ranking the code stands alone —
 * printing "11" next to a Challenger field of players ranked 150-350 would be
 * plainly wrong, and printing "11 JR" invites the reader to compare them anyway.
 */
export function rankingDisplay(rank: number | null | undefined, code: string | null | undefined): string {
  const known = normalizeEntryCode(code);
  if (known && FOREIGN_RANKING.has(known)) return known;
  if (rank == null) return known ?? '';
  return known ? `${rank} ${known}` : String(rank);
}

/**
 * Which levels each accelerator pathway may be used at. A code turning up
 * outside its level is a signal that the source or the parse is wrong, not a
 * new rule — the pathways are defined per Challenger level.
 */
const LEVEL_ELIGIBILITY: Partial<Record<EntryCode, readonly string[]>> = {
  NG: ['CH 50', 'CH 75', 'CH 100', 'CH 125'],
  JR: ['CH 50', 'CH 75'],
  CO: ['CH 50', 'CH 75'],
};

export function codeAllowedAtLevel(code: string | null | undefined, level: string): boolean {
  const known = normalizeEntryCode(code);
  if (!known) return true;
  const levels = LEVEL_ELIGIBILITY[known];
  return !levels || levels.includes(level.trim());
}

/**
 * Count of each code present, in a fixed order, for a list summary. Direct
 * acceptances carry no code and are not counted here — the point is to show
 * what part of a draw was NOT filled from the ranking list, which is exactly
 * what differs between events and between levels.
 */
export function codeBreakdown(codes: Array<string | null | undefined>): Array<{ code: EntryCode; count: number }> {
  const order: EntryCode[] = ['WC', 'PR', 'SE', 'NG', 'JR', 'CO', 'Q', 'ALT'];
  const counts = new Map<EntryCode, number>();
  for (const raw of codes) {
    const known = normalizeEntryCode(raw);
    if (!known) continue;
    counts.set(known, (counts.get(known) ?? 0) + 1);
  }
  return order
    .filter((code) => counts.has(code))
    .map((code) => ({ code, count: counts.get(code) as number }));
}

// Rank check across a swing (Swings phase 3c). Pure logic: given a player's
// singles ranking and a tournament's most recent historical cutoff, say where
// they'd stand. Descriptive only — it reports against past cut numbers, it does
// not predict future acceptance.

export type CutReference = {
  /** Worst rank that got direct entry to the main draw. */
  mainCut: number | null;
  /** Worst rank that got in off the main-draw alternate list. */
  mainAlt: number | null;
  /** Worst rank that got direct entry to qualifying. */
  qualCut: number | null;
  /** Season the reference cut is from (e.g. 2025 for a 2026 stop). */
  fromYear: number | null;
};

/** Singles and doubles reference cuts for one tournament. */
export type TournamentCutRefs = {
  singles: CutReference;
  doubles: CutReference;
};

export const EMPTY_CUT_REFERENCE: CutReference = {
  mainCut: null,
  mainAlt: null,
  qualCut: null,
  fromYear: null,
};

export type EntryStatus = 'main' | 'alternate' | 'qualifying' | 'out' | 'unknown';

export const STATUS_META: Record<EntryStatus, { label: string; short: string; color: string }> = {
  main: { label: 'Main draw', short: 'MD', color: '#22c55e' },
  alternate: { label: 'Alternate', short: 'ALT', color: '#2dd4bf' },
  qualifying: { label: 'Qualifying', short: 'Q', color: '#fbbf24' },
  out: { label: 'Out', short: 'OUT', color: '#f87171' },
  unknown: { label: 'No cut data', short: '—', color: '#64748b' },
};

/**
 * Where a player of `rank` would have stood for a stop, given its reference
 * cut. Lower rank number = better. Checks main draw, then main-draw alternate,
 * then qualifying; "out" only when at least one cut number is known.
 */
export function entryStatus(rank: number | null, ref: CutReference | null | undefined): EntryStatus {
  if (rank == null || !Number.isFinite(rank) || !ref) return 'unknown';
  const known = ref.mainCut != null || ref.mainAlt != null || ref.qualCut != null;
  if (!known) return 'unknown';
  if (ref.mainCut != null && rank <= ref.mainCut) return 'main';
  if (ref.mainAlt != null && rank <= ref.mainAlt) return 'alternate';
  if (ref.qualCut != null && rank <= ref.qualCut) return 'qualifying';
  return 'out';
}

export type EntrySummary = {
  main: number;
  alternate: number;
  qualifying: number;
  out: number;
  unknown: number;
  total: number;
};

export function summarizeEntries(statuses: EntryStatus[]): EntrySummary {
  const s: EntrySummary = { main: 0, alternate: 0, qualifying: 0, out: 0, unknown: 0, total: statuses.length };
  for (const st of statuses) s[st] += 1;
  return s;
}

/** One-line summary, e.g. "5 main draw · 1 qualies · 1 out". */
export function describeEntrySummary(s: EntrySummary): string {
  const parts: string[] = [];
  if (s.main) parts.push(`${s.main} main draw`);
  if (s.alternate) parts.push(`${s.alternate} alternate`);
  if (s.qualifying) parts.push(`${s.qualifying} qualies`);
  if (s.out) parts.push(`${s.out} out`);
  if (s.unknown) parts.push(`${s.unknown} no data`);
  return parts.join(' · ');
}

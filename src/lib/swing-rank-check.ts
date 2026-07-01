// Rank check across a swing (Swings phase 3c). Pure logic: given a player's
// singles ranking and a tournament's most recent historical cutoff, say where
// they'd stand. Descriptive only — it reports against past cut numbers, it does
// not predict future acceptance.

export type CutReference = {
  /** Worst rank that got direct entry to the main draw (before alternates). */
  mainCut: number | null;
  /** Worst rank that ultimately made the main draw once alternates got in.
   * Usually a bigger (worse) number than mainCut; not every event has one. */
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

export type EntryStatus = 'main' | 'qualifying' | 'out' | 'unknown';

// Colors resolve through CSS variables so each theme can pick a readable
// shade (amber/red need darker cuts on the light background). Fallbacks keep
// non-DOM consumers (e.g. tests) working.
export const STATUS_META: Record<EntryStatus, { label: string; short: string; color: string }> = {
  main: { label: 'Main draw', short: 'MD', color: 'var(--status-main, #22c55e)' },
  qualifying: { label: 'Qualifying', short: 'Q', color: 'var(--status-q, #fbbf24)' },
  out: { label: 'Out', short: 'OUT', color: 'var(--status-out, #f87171)' },
  unknown: { label: 'No cut data', short: '—', color: 'var(--status-unknown, #64748b)' },
};

/**
 * Effective main-draw cut: the most generous (largest/worst) of the direct
 * acceptance number and the alternate-inclusive number. If a tournament took
 * alternates last year (direct cut 300, but alternates pushed it to 325), then
 * a player ranked 320 would have made the main draw — so 325 is the real cut.
 */
export function mainDrawCut(ref: CutReference): number | null {
  const vals = [ref.mainCut, ref.mainAlt].filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Where a player of `rank` would have stood for a stop, given its reference
 * cut. Lower rank number = better. Alternates are folded into the main draw
 * (see mainDrawCut); "out" only when at least one cut number is known.
 */
export function entryStatus(rank: number | null, ref: CutReference | null | undefined): EntryStatus {
  if (rank == null || !Number.isFinite(rank) || !ref) return 'unknown';
  const mainT = mainDrawCut(ref);
  if (mainT == null && ref.qualCut == null) return 'unknown';
  if (mainT != null && rank <= mainT) return 'main';
  if (ref.qualCut != null && rank <= ref.qualCut) return 'qualifying';
  return 'out';
}

export type EntrySummary = {
  main: number;
  qualifying: number;
  out: number;
  unknown: number;
  total: number;
};

export function summarizeEntries(statuses: EntryStatus[]): EntrySummary {
  const s: EntrySummary = { main: 0, qualifying: 0, out: 0, unknown: 0, total: statuses.length };
  for (const st of statuses) s[st] += 1;
  return s;
}

/** One-line summary, e.g. "5 main draw · 1 qualies · 1 out". */
export function describeEntrySummary(s: EntrySummary): string {
  const parts: string[] = [];
  if (s.main) parts.push(`${s.main} main draw`);
  if (s.qualifying) parts.push(`${s.qualifying} qualies`);
  if (s.out) parts.push(`${s.out} out`);
  if (s.unknown) parts.push(`${s.unknown} no data`);
  return parts.join(' · ');
}

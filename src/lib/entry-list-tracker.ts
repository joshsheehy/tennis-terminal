export type EntryListDraw = 'main' | 'qualifying';

/**
 * Doubles is a separate list, not a variant of the singles one: it has its own
 * acceptance order, its own cut, and at ATP level its own alternate queue.
 * Without this dimension a doubles snapshot would overwrite the singles one for
 * the same tournament and draw.
 *
 * Optional, defaulting to singles, so snapshots captured before doubles existed
 * in the model keep their meaning.
 */
export type EntryListDiscipline = 'singles' | 'doubles';
export type EntryListPhase = 'advance' | 'onsite';
export type EntryListOriginalStatus = 'accepted' | 'alternate';
export type EntryListCurrentStatus = 'accepted' | 'alternate' | 'withdrawn';

export type EntryListSourceRef = {
  label: string;
  url?: string;
  observedAt: string;
  sourceId?: string;
};

/**
 * Immutable row from the first verified published list.
 *
 * entryRank and original order are historical facts. Never replace them with a
 * player's current ATP ranking and never re-sort the snapshot after ingest.
 */
export type EntryListSnapshotEntry = {
  name: string;
  country?: string | null;
  entryRank: number | null;
  entryCode?: string | null;
  originalStatus: EntryListOriginalStatus;
  originalListPosition: number;
  originalAlternatePosition: number | null;
};

export type EntryListSnapshot = {
  tournamentSlug: string;
  draw: EntryListDraw;
  /** Defaults to singles when absent. */
  discipline?: EntryListDiscipline;
  phase: EntryListPhase;
  rankingDate?: string | null;
  publishedAt?: string | null;
  source: EntryListSourceRef;
  entries: EntryListSnapshotEntry[];
};

export type EntryListMovementKind =
  | 'withdrawal'
  | 'promotion'
  | 'alternate-withdrawal'
  | 'reported-next';

/** A sourced change after the immutable list snapshot. */
export type EntryListMovement = {
  tournamentSlug: string;
  draw: EntryListDraw;
  /** Defaults to singles when absent. */
  discipline?: EntryListDiscipline;
  phase: EntryListPhase;
  kind: EntryListMovementKind;
  playerName: string;
  observedAt: string;
  source: EntryListSourceRef;
  rawText?: string;
};

export type ParsedMovementUpdate = {
  out: string[];
  in: string[];
  next: string[];
};

export type DerivedEntryListRow = EntryListSnapshotEntry & {
  currentStatus: EntryListCurrentStatus;
  currentAlternatePosition: number | null;
};

export type DerivedEntryListState = {
  rows: DerivedEntryListRow[];
  reportedNext: string | null;
  unmatchedMovements: EntryListMovement[];
};

export function entryListNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cleanMovementName(value: string): string {
  return value
    .trim()
    .replace(/^[-–—•\s]+/, '')
    .replace(/\s+\((?:alts?|alt|lls?|lucky losers?|in)\)\s*$/i, '')
    .trim();
}

function splitMovementNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*(?:,|;|•|\n|\s+[–—]\s+)\s*/)
    .map(cleanMovementName)
    .filter(Boolean);
}

function labelledSegment(text: string, label: 'OUT' | 'IN' | 'NEXT'): string | undefined {
  const labels = ['OUT', 'IN', 'NEXT'].filter((item) => item !== label).join('|');
  const expression = new RegExp(`\\b${label}\\s*:\\s*([\\s\\S]*?)(?=\\b(?:${labels})\\s*:|$)`, 'i');
  return text.match(expression)?.[1]?.trim();
}

/**
 * Parse the compact movement syntax commonly used by public tennis list
 * trackers, for example:
 *   OUT: A, B IN: C, D Next: E
 *
 * Parsing is deliberately conservative: it records what the source explicitly
 * says and does not infer queue positions from ranking.
 */
export function parseEntryListMovementUpdate(text: string): ParsedMovementUpdate {
  return {
    out: splitMovementNames(labelledSegment(text, 'OUT')),
    in: splitMovementNames(labelledSegment(text, 'IN')),
    next: splitMovementNames(labelledSegment(text, 'NEXT')),
  };
}

export function movementsFromParsedUpdate(
  parsed: ParsedMovementUpdate,
  context: {
    tournamentSlug: string;
    draw: EntryListDraw;
    phase: EntryListPhase;
    observedAt: string;
    source: EntryListSourceRef;
    rawText?: string;
  }
): EntryListMovement[] {
  const common = {
    tournamentSlug: context.tournamentSlug,
    draw: context.draw,
    phase: context.phase,
    observedAt: context.observedAt,
    source: context.source,
    ...(context.rawText ? { rawText: context.rawText } : {}),
  };

  return [
    ...parsed.out.map((playerName) => ({
      ...common,
      kind: 'withdrawal' as const,
      playerName,
    })),
    ...parsed.in.map((playerName) => ({
      ...common,
      kind: 'promotion' as const,
      playerName,
    })),
    ...parsed.next.map((playerName) => ({
      ...common,
      kind: 'reported-next' as const,
      playerName,
    })),
  ];
}

/**
 * Reduce sourced movements onto the immutable snapshot. The reducer never
 * mutates entryRank, originalListPosition or originalAlternatePosition.
 */
export function deriveEntryListState(
  snapshot: EntryListSnapshot,
  movements: EntryListMovement[]
): DerivedEntryListState {
  const relevant = movements
    .filter(
      (movement) =>
        movement.tournamentSlug === snapshot.tournamentSlug &&
        movement.draw === snapshot.draw &&
        movement.phase === snapshot.phase
    )
    .map((movement, index) => ({ movement, index }))
    .sort((a, b) => {
      const byTime = a.movement.observedAt.localeCompare(b.movement.observedAt);
      return byTime || a.index - b.index;
    })
    .map(({ movement }) => movement);

  const byName = new Map(
    snapshot.entries.map((entry) => [entryListNameKey(entry.name), entry] as const)
  );
  const withdrawn = new Set<string>();
  const promoted = new Set<string>();
  const unmatchedMovements: EntryListMovement[] = [];
  let reportedNext: string | null = null;

  for (const movement of relevant) {
    const key = entryListNameKey(movement.playerName);

    if (movement.kind === 'reported-next') {
      reportedNext = movement.playerName;
      if (!byName.has(key)) unmatchedMovements.push(movement);
      continue;
    }

    if (!byName.has(key)) {
      unmatchedMovements.push(movement);
      continue;
    }

    if (movement.kind === 'withdrawal' || movement.kind === 'alternate-withdrawal') {
      withdrawn.add(key);
      promoted.delete(key);
      continue;
    }

    if (movement.kind === 'promotion') {
      promoted.add(key);
      withdrawn.delete(key);
    }
  }

  const activeAlternates = snapshot.entries
    .filter((entry) => entry.originalStatus === 'alternate')
    .filter((entry) => {
      const key = entryListNameKey(entry.name);
      return !withdrawn.has(key) && !promoted.has(key);
    })
    .sort((a, b) => a.originalListPosition - b.originalListPosition);

  const alternatePosition = new Map(
    activeAlternates.map((entry, index) => [entryListNameKey(entry.name), index + 1] as const)
  );

  const rows = snapshot.entries
    .map((entry): DerivedEntryListRow => {
      const key = entryListNameKey(entry.name);
      const isWithdrawn = withdrawn.has(key);
      const isPromoted = promoted.has(key);

      let currentStatus: EntryListCurrentStatus;
      if (isWithdrawn) currentStatus = 'withdrawn';
      else if (entry.originalStatus === 'accepted' || isPromoted) currentStatus = 'accepted';
      else currentStatus = 'alternate';

      return {
        ...entry,
        currentStatus,
        currentAlternatePosition:
          currentStatus === 'alternate' ? alternatePosition.get(key) ?? null : null,
      };
    })
    .sort((a, b) => a.originalListPosition - b.originalListPosition);

  return { rows, reportedNext, unmatchedMovements };
}

function rowStandingLabel(draw: EntryListDraw, row: DerivedEntryListRow): string {
  const prefix = draw === 'qualifying' ? 'Q' : 'MD';
  if (row.currentStatus === 'withdrawn') return 'OUT';
  if (row.currentStatus === 'accepted') {
    return row.originalStatus === 'alternate' ? `${prefix} IN` : prefix;
  }
  return `${prefix} ALT ${row.currentAlternatePosition ?? '?'}`;
}

/**
 * Build the player-facing movement history, including queue compression caused
 * by other players moving out/in.
 */
export function entryListTrajectory(
  snapshot: EntryListSnapshot,
  movements: EntryListMovement[],
  playerName: string
): string[] {
  const key = entryListNameKey(playerName);
  if (!snapshot.entries.some((entry) => entryListNameKey(entry.name) === key)) return [];

  const relevant = movements
    .filter(
      (movement) =>
        movement.tournamentSlug === snapshot.tournamentSlug &&
        movement.draw === snapshot.draw &&
        movement.phase === snapshot.phase
    )
    .map((movement, index) => ({ movement, index }))
    .sort((a, b) => {
      const byTime = a.movement.observedAt.localeCompare(b.movement.observedAt);
      return byTime || a.index - b.index;
    })
    .map(({ movement }) => movement);

  const labels: string[] = [];
  for (let count = 0; count <= relevant.length; count += 1) {
    const state = deriveEntryListState(snapshot, relevant.slice(0, count));
    const row = state.rows.find((item) => entryListNameKey(item.name) === key);
    if (!row) continue;
    const label = rowStandingLabel(snapshot.draw, row);
    if (labels.at(-1) !== label) labels.push(label);
  }
  return labels;
}

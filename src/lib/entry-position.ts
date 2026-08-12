// Where a given ranking would sit on an entry list.
//
// The lists themselves are only half the question. A player looking at six
// Challengers in one week does not want to read six tables and count — they
// want to know which one they get into. That is computable from the lists we
// already have: sort the field, count how many are ahead of you, compare with
// how many places the draw has.
//
// This is deliberately a POSITION, not a probability. Alternate order is the
// number players actually act on ("I'm ALT 3, worth flying") and it follows
// from the list directly. A probability would need withdrawal rates we have not
// measured, and would dress a guess up as a forecast.

export type EntryDraw = 'main' | 'qualifying';

export type ListEntrant = {
  name: string;
  rank: number | null;
};

export type Standing = {
  draw: EntryDraw;
  /** 1-based place in the combined accepted + waiting queue. */
  position: number;
  /** Null when the ranking is inside the draw; otherwise 1 = next in line. */
  alternateNumber: number | null;
  /** How many entrants are ranked better. */
  ahead: number;
  /** Places in the draw itself, excluding the waiting queue. */
  drawSize: number;
};

/**
 * Where `rank` would sit if it entered this draw.
 *
 * Unranked entrants are treated as behind every ranked one: they are protected
 * or wildcard-type entries who do not out-rank a ranked player in list order.
 * A better (lower) ranking is ahead; ties fall behind the incumbent, because an
 * existing entrant is not displaced by an equal ranking.
 */
export function standingFor(
  rank: number,
  accepted: ListEntrant[],
  waiting: ListEntrant[],
  draw: EntryDraw
): Standing {
  const field = [...accepted, ...waiting];
  const ahead = field.filter((e) => e.rank != null && e.rank <= rank).length;
  const drawSize = accepted.length;
  const position = ahead + 1;
  return {
    draw,
    position,
    alternateNumber: position > drawSize ? position - drawSize : null,
    ahead,
    drawSize,
  };
}

export type EventStanding = {
  slug: string;
  name: string;
  level: string;
  surface: string;
  main: Standing;
  qualifying: Standing;
  /** The better of the two for this ranking. */
  best: Standing;
  /** Ordering key: lower is a better outcome for the player. */
  score: number;
};

/**
 * Rank an event by how good the outcome is for this player.
 *
 * Straight into the main draw beats anything. Otherwise a qualifying place
 * beats being an alternate, since a qualifying spot is a guaranteed match and
 * an alternate spot is a wait. Alternates are then ordered by queue position.
 */
export function outcomeScore(main: Standing, qualifying: Standing): number {
  if (main.alternateNumber == null) return 0; // direct into the main draw
  if (qualifying.alternateNumber == null) return 1000 + qualifying.position;
  if (main.alternateNumber <= qualifying.alternateNumber) {
    return 2000 + main.alternateNumber;
  }
  return 3000 + qualifying.alternateNumber;
}

export function describeStanding(s: Standing): string {
  const label = s.draw === 'main' ? 'main draw' : 'qualifying';
  if (s.alternateNumber == null) return `In the ${label}`;
  return `${label} alternate ${s.alternateNumber}`;
}

export function standingsForEvents(
  rank: number,
  events: Array<{
    slug: string;
    name: string;
    level: string;
    surface: string;
    main: ListEntrant[];
    mainNext: ListEntrant[];
    qualifying: ListEntrant[];
    /** Optional: most sources publish only a main-draw next-in queue. */
    qualifyingNext?: ListEntrant[];
  }>
): EventStanding[] {
  return events
    .map((e) => {
      const main = standingFor(rank, e.main, e.mainNext, 'main');
      const qualifying = standingFor(rank, e.qualifying, e.qualifyingNext ?? [], 'qualifying');
      const score = outcomeScore(main, qualifying);
      return {
        slug: e.slug,
        name: e.name,
        level: e.level,
        surface: e.surface,
        main,
        qualifying,
        best: score < 1000 || (score >= 2000 && score < 3000) ? main : qualifying,
        score,
      };
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

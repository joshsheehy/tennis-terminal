// Grouping and labels for the Saved page: which saved tournaments are on now,
// coming up, or done, and a short "In 2 weeks" / "Last month" line for each.
// Pure (no database) so it can be unit-tested; dates are ISO calendar days.

export type Phase = 'current' | 'upcoming' | 'past';

export type SavedItem = {
  editionId: string;
  slug: string;
  year: number;
  name: string;
  city: string;
  country: string | null;
  level: string;
  start: string | null; // YYYY-MM-DD
  end: string | null; // YYYY-MM-DD
};

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

// Index of the Monday-to-Sunday week containing `iso` (day 0, 1970-01-01, was
// a Thursday, hence the +3).
function mondayWeek(iso: string): number {
  return Math.floor((dayNumber(iso) + 3) / 7);
}

// A tournament without an end date is treated as a one-week event.
function lastDay(item: SavedItem): string | null {
  if (item.end) return item.end;
  if (!item.start) return null;
  return new Date((dayNumber(item.start) + 6) * DAY_MS).toISOString().slice(0, 10);
}

export function phaseOf(item: SavedItem, today: string): Phase {
  const last = lastDay(item);
  if (!item.start || !last) return 'upcoming'; // undated: keep it visible
  if (last < today) return 'past';
  if (item.start <= today) return 'current';
  return 'upcoming';
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export function relativeLabel(item: SavedItem, today: string): string {
  const phase = phaseOf(item, today);
  if (!item.start) return 'Dates TBD';
  if (phase === 'current') return 'This week';
  if (phase === 'upcoming') {
    // Tournament weeks run Monday–Sunday, so "next week" means the next
    // calendar week, not "7+ days away".
    const days = dayNumber(item.start) - dayNumber(today);
    const weeks = mondayWeek(item.start) - mondayWeek(today);
    if (weeks === 0) return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;
    if (weeks === 1) return 'Next week';
    if (weeks < 9) return `In ${weeks} weeks`;
    return `In ${plural(Math.round(days / 30), 'month')}`;
  }
  const ago = dayNumber(today) - dayNumber(lastDay(item)!);
  if (ago < 8) return 'Last week';
  if (ago < 60) return `${Math.round(ago / 7)} weeks ago`;
  if (ago < 330) return `${plural(Math.round(ago / 30), 'month')} ago`;
  const years = Math.max(1, Math.round(ago / 365));
  return years === 1 ? 'Last year' : `${years} years ago`;
}

export function groupSaved(items: SavedItem[], today: string): Record<Phase, SavedItem[]> {
  const byStart = (a: SavedItem, b: SavedItem) => (a.start ?? '9999').localeCompare(b.start ?? '9999');
  const groups: Record<Phase, SavedItem[]> = { current: [], upcoming: [], past: [] };
  for (const item of items) groups[phaseOf(item, today)].push(item);
  groups.current.sort(byStart);
  groups.upcoming.sort(byStart);
  groups.past.sort((a, b) => byStart(b, a)); // most recent first
  return groups;
}

// Open on what's happening now, else what's next, else history.
export function defaultPhase(groups: Record<Phase, SavedItem[]>): Phase {
  if (groups.current.length) return 'current';
  if (groups.upcoming.length) return 'upcoming';
  return groups.past.length ? 'past' : 'upcoming';
}

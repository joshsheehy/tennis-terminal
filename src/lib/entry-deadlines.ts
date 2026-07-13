// Entry-deadline rules per tour category. Sources:
//   ATP Tour & Challenger — 2026 ATP Official Rulebook §7.03 "Entry Deadlines".
//     Deadlines are 12:00 noon Eastern Time, counted back from the MONDAY of
//     the tournament week:
//       Singles main draw:  ATP = 28 days,   Challenger = 21 days
//       Singles qualifying: ATP = 21 days,   Challenger = 19 days (Wednesday)
//       Doubles main draw:  ATP = 14 days,   Challenger =  7 days
//   ITF World Tennis Tour — 2026 WTT Regulations. Entry deadline is 14:00 GMT
//     on the Thursday 18 days before the Monday of the tournament week.
//   Grand Slam — 2026 Official Grand Slam Rule Book §Z "Entry Procedures":
//     singles main draw closes 42 days prior to the first Monday, singles
//     qualifying 28 days prior. The doubles deadline is published per event in
//     the official entry form (typically ~2 weeks out), so ours is approximate.
//
// A subscriber chooses which of these categories they want alerts for.

import { ScheduleRow } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type Category = 'atp' | 'challenger' | 'itf' | 'grandslam';

export const CATEGORIES: Category[] = ['atp', 'challenger', 'itf', 'grandslam'];

export const CATEGORY_LABEL: Record<Category, string> = {
  atp: 'ATP Tour (250 / 500 / 1000)',
  challenger: 'ATP Challenger Tour',
  itf: 'ITF World Tennis Tour',
  grandslam: 'Grand Slam',
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as string[]).includes(value);
}

// Reminder lead times a subscriber can pick, in hours before the deadline
// moment. The hourly cron fires each window once per (subscriber, deadline).
export const REMINDER_WINDOWS = [24, 12, 1] as const;

export function normalizeReminderHours(input: unknown): number[] {
  const arr = Array.isArray(input) ? input : [];
  const allowed = new Set<number>(REMINDER_WINDOWS);
  const valid = arr.map((v) => Number(v)).filter((v) => allowed.has(v));
  const deduped = Array.from(new Set(valid)).sort((a, b) => b - a);
  return deduped.length ? deduped : [24];
}

// Parse a "?cats=atp,itf" query param into a category list; empty/invalid input
// falls back to all categories (useful for the admin test endpoint).
export function normalizeCategoriesFromParam(raw: string | null): Category[] {
  if (!raw) return [...CATEGORIES];
  const parsed = raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(isCategory) as Category[];
  return parsed.length ? Array.from(new Set(parsed)) : [...CATEGORIES];
}

type RuleDef = {
  kind: string; // stable id, part of the dedupe key
  label: string; // human label shown in emails
  daysPrior: number; // days before the Monday of the tournament week
  timeNote: string; // when on that day the deadline falls
};

const CATEGORY_RULES: Record<Category, RuleDef[]> = {
  atp: [
    { kind: 'main', label: 'Singles main draw', daysPrior: 28, timeNote: '12:00 noon ET' },
    { kind: 'qualifying', label: 'Singles qualifying', daysPrior: 21, timeNote: '12:00 noon ET' },
    { kind: 'doubles', label: 'Doubles (advance entry)', daysPrior: 14, timeNote: '12:00 noon ET' },
  ],
  challenger: [
    { kind: 'main', label: 'Singles main draw', daysPrior: 21, timeNote: '12:00 noon ET' },
    { kind: 'qualifying', label: 'Singles qualifying', daysPrior: 19, timeNote: '12:00 noon ET (Wed)' },
    { kind: 'doubles', label: 'Doubles (advance entry)', daysPrior: 7, timeNote: '12:00 noon ET' },
  ],
  itf: [
    { kind: 'entry', label: 'Entry deadline', daysPrior: 18, timeNote: '14:00 GMT (Thu)' },
  ],
  grandslam: [
    { kind: 'main', label: 'Singles main draw', daysPrior: 42, timeNote: 'time per event' },
    { kind: 'qualifying', label: 'Singles qualifying', daysPrior: 28, timeNote: 'time per event' },
    { kind: 'doubles', label: 'Doubles (advance entry)', daysPrior: 14, timeNote: 'approx.; set by each event' },
  ],
};

// Map a tournament level string ("ATP 250", "Challenger 75", "ITF M25",
// "Grand Slam"…) to its category, or null when no rule governs it.
export function categoryForLevel(level: string): Category | null {
  const l = level.trim().toLowerCase();
  if (l.startsWith('challenger')) return 'challenger';
  if (l.startsWith('atp')) return 'atp';
  if (l.startsWith('grand slam')) return 'grandslam';
  if (l.startsWith('itf')) return 'itf';
  return null;
}

function parseUtcDateOnly(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

// The Monday on or before a date. Tournament start_dates are normally already a
// Monday, but a stray Sunday/Tuesday shouldn't shift every deadline by a day.
export function mondayOfWeekUtc(date: Date): Date {
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay(); // Sun=7
  return new Date(date.getTime() - (isoDow - 1) * MS_PER_DAY);
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// --- Deadline moments -------------------------------------------------------
// ATP/Challenger deadlines are 12:00 noon US Eastern; ITF is 14:00 GMT. Grand
// Slam times are published per event, so noon ET stands in as the approximation
// (the timeNote already says so). US DST: second Sunday of March to first
// Sunday of November, so noon ET = 16:00 UTC in summer, 17:00 UTC in winter.

function nthSundayUtc(year: number, monthIdx: number, n: number): Date {
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const firstSundayDay = 1 + ((7 - first.getUTCDay()) % 7);
  return new Date(Date.UTC(year, monthIdx, firstSundayDay + (n - 1) * 7));
}

function noonEasternIso(dateIso: string): string {
  const day = new Date(`${dateIso}T00:00:00Z`);
  const year = day.getUTCFullYear();
  const dstStart = nthSundayUtc(year, 2, 2); // second Sunday of March
  const dstEnd = nthSundayUtc(year, 10, 1); // first Sunday of November
  const offset = day >= dstStart && day < dstEnd ? 4 : 5;
  return new Date(day.getTime() + (12 + offset) * 60 * 60 * 1000).toISOString();
}

function deadlineMomentIso(category: Category, deadlineDate: string): string {
  if (category === 'itf') return new Date(`${deadlineDate}T14:00:00Z`).toISOString();
  return noonEasternIso(deadlineDate);
}

export type Deadline = {
  editionId: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  level: string;
  category: Category;
  categoryLabel: string;
  kind: string;
  kindLabel: string;
  tournamentStart: string; // YYYY-MM-DD, Monday of the tournament week
  daysPrior: number;
  deadlineDate: string; // YYYY-MM-DD the deadline falls on
  deadlineAtIso: string; // the actual deadline moment (noon ET / 14:00 GMT)
  timeNote: string;
  // Hours between "now" and deadlineAtIso; set by dueReminderDeadlines so the
  // email can say how close each deadline is.
  hoursLeft?: number;
  // Set on the synthetic ITF row that stands in for every ITF tournament
  // sharing a week (there are dozens weekly, so we never list them all).
  aggregate?: boolean;
  tournamentCount?: number;
  // Set on the Grand Slam main-draw row: the qualifying deadline date for the
  // same event, so the main-draw alert can mention when Qs entries close too.
  qualifyingDeadlineDate?: string;
};

// All entry deadlines for a single tournament edition, or [] for levels with no
// rule (unknown / not covered).
export function deadlinesForEdition(row: ScheduleRow): Deadline[] {
  const category = categoryForLevel(row.level);
  if (!category) return [];

  const start = parseUtcDateOnly(row.start_date);
  if (!start) return [];
  const monday = mondayOfWeekUtc(start);

  const rules = CATEGORY_RULES[category];
  const qualifyingRule = rules.find((r) => r.kind === 'qualifying');

  return rules.map((rule) => {
    const deadline = new Date(monday.getTime() - rule.daysPrior * MS_PER_DAY);
    const deadlineDate = toDateOnlyString(deadline);
    const d: Deadline = {
      editionId: row.edition_id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      country: row.country,
      level: row.level,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      kind: rule.kind,
      kindLabel: rule.label,
      tournamentStart: toDateOnlyString(monday),
      daysPrior: rule.daysPrior,
      deadlineDate,
      deadlineAtIso: deadlineMomentIso(category, deadlineDate),
      timeNote: rule.timeNote,
    };
    // Grand Slams are the events people plan around, so their main-draw alert
    // also carries the (later) qualifying deadline date for the same event.
    if (category === 'grandslam' && rule.kind === 'main' && qualifyingRule) {
      d.qualifyingDeadlineDate = toDateOnlyString(
        new Date(monday.getTime() - qualifyingRule.daysPrior * MS_PER_DAY)
      );
    }
    return d;
  });
}

// Collapse per-tournament ITF deadlines into one synthetic row per tournament
// week. There are dozens of ITF events every week with the identical deadline,
// so listing them individually would drown the email; one line ("47 ITF
// tournaments, entries close Thursday") is the useful signal.
function aggregateItf(deadlines: Deadline[]): Deadline[] {
  const kept: Deadline[] = [];
  const itfByWeek = new Map<string, Deadline[]>();
  for (const d of deadlines) {
    if (d.category !== 'itf') {
      kept.push(d);
      continue;
    }
    const group = itfByWeek.get(d.tournamentStart);
    if (group) group.push(d);
    else itfByWeek.set(d.tournamentStart, [d]);
  }
  for (const [weekMonday, group] of itfByWeek) {
    const first = group[0];
    kept.push({
      ...first,
      // Stable synthetic id: same week -> same dedupe key on every run, and
      // an ITF event added later that week can't re-trigger the alert.
      editionId: `itf-week-${weekMonday}`,
      slug: '',
      name: 'ITF World Tennis Tour',
      city: '',
      country: null,
      level: 'ITF',
      kindLabel: 'Entry deadline (all tournaments)',
      aggregate: true,
      tournamentCount: group.length,
    });
  }
  return kept;
}

// Deadlines that fall due within the next `leadDays` days of `today` — i.e.
// deadlineDate is in [today, today + leadDays]. With leadDays = 1 (the default)
// this is the "~24 hours before" window: it fires the day before the deadline,
// and also catches a same-day deadline if a cron run was missed. Filtered to the
// caller's chosen categories. Doubles (advance-entry) deadlines are opt-in via
// includeDoubles for every tour. ITF rows come back as one aggregate line per
// tournament week, never per event.
export function dueDeadlines(
  rows: ScheduleRow[],
  today: Date,
  opts: {
    leadDays?: number;
    categories?: Category[];
    includeDoubles?: boolean;
  } = {}
): Deadline[] {
  const leadDays = opts.leadDays ?? 1;
  const categories = opts.categories ?? CATEGORIES;
  const includeDoubles = opts.includeDoubles ?? false;
  const wanted = new Set(categories);

  const start = parseUtcDateOnly(today);
  if (!start) return [];
  const end = new Date(start.getTime() + leadDays * MS_PER_DAY);

  const out: Deadline[] = [];
  for (const row of rows) {
    for (const d of deadlinesForEdition(row)) {
      if (!wanted.has(d.category)) continue;
      if (!includeDoubles && d.kind === 'doubles') continue;
      const when = parseUtcDateOnly(d.deadlineDate);
      if (!when) continue;
      if (when.getTime() >= start.getTime() && when.getTime() <= end.getTime()) {
        out.push(d);
      }
    }
  }
  const collapsed = aggregateItf(out);
  // Order by event prestige (Grand Slam -> Masters 1000 -> other ATP ->
  // Challenger -> ITF); within a tier, soonest deadline first, then name.
  collapsed.sort((a, b) => {
    if (eventRank(a) !== eventRank(b)) return eventRank(a) - eventRank(b);
    if (a.deadlineDate !== b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
    return a.name.localeCompare(b.name);
  });
  return collapsed;
}

// Category bands for ordering the alert email, most prestigious first.
const CATEGORY_BAND: Record<Category, number> = { grandslam: 1, atp: 2, challenger: 3, itf: 4 };

// Prestige rank used to order the alert email (lower = higher up). Categories
// band first — Grand Slam, then ATP, Challenger, ITF — and WITHIN a category the
// numeric level breaks the tie so the bigger event leads:
//   ATP 1000 > 500 > 250 · Challenger 175 > 125 > 100 > 75 > 50 · ITF M25 > M15.
// The number is subtracted so a higher level yields a lower (earlier) rank; the
// 100000 band gap is far larger than any level number, so bands never overlap.
export function eventRank(d: Deadline): number {
  const m = d.level.match(/(\d+)/); // first number in the level string, if any
  const levelNum = m ? parseInt(m[1], 10) : 0;
  return CATEGORY_BAND[d.category] * 100000 - levelNum;
}

export type DueReminder = Deadline & {
  hoursLeft: number;
  /** The subscriber's reminder windows this deadline is currently inside. */
  dueWindows: number[];
};

// The hourly-cron variant of dueDeadlines: instead of a whole-day window, each
// deadline is compared to its actual moment (noon ET / 14:00 GMT), and a
// reminder window `w` is due when 0 < hoursLeft <= w. Per-window dedupe keys
// (reminderKey) make each window fire exactly once per (subscriber, deadline):
// a subscriber on 24+12+1 gets three emails, at ~24h, ~12h and ~1h out. A
// deadline already past (hoursLeft <= 0) is never worth an email. Doubles stay
// opt-in via includeDoubles, exactly as in dueDeadlines.
export function dueReminderDeadlines(
  rows: ScheduleRow[],
  now: Date,
  opts: {
    windows: number[];
    categories?: Category[];
    includeDoubles?: boolean;
  }
): DueReminder[] {
  const categories = opts.categories ?? CATEGORIES;
  const includeDoubles = opts.includeDoubles ?? false;
  const windows = normalizeReminderHours(opts.windows);
  const wanted = new Set(categories);
  const maxWindow = Math.max(...windows);

  const out: Deadline[] = [];
  for (const row of rows) {
    for (const d of deadlinesForEdition(row)) {
      if (!wanted.has(d.category)) continue;
      if (!includeDoubles && d.kind === 'doubles') continue;
      const hoursLeft = (new Date(d.deadlineAtIso).getTime() - now.getTime()) / (60 * 60 * 1000);
      if (hoursLeft <= 0 || hoursLeft > maxWindow) continue;
      out.push(d);
    }
  }
  // Aggregate ITF first so the week row carries a single set of windows, then
  // order by prestige exactly like the daily digest.
  const collapsed = aggregateItf(out)
    .map((d) => {
      const hoursLeft = (new Date(d.deadlineAtIso).getTime() - now.getTime()) / (60 * 60 * 1000);
      return {
        ...d,
        hoursLeft: Math.round(hoursLeft * 10) / 10,
        dueWindows: windows.filter((w) => hoursLeft <= w),
      };
    })
    .filter((d) => d.dueWindows.length > 0);
  collapsed.sort((a, b) => {
    if (eventRank(a) !== eventRank(b)) return eventRank(a) - eventRank(b);
    if (a.deadlineDate !== b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
    return a.name.localeCompare(b.name);
  });
  return collapsed;
}

// Stable idempotency key for one deadline occurrence, so a subscriber is never
// emailed about the same deadline twice.
export function deadlineKey(d: Deadline): string {
  return `${d.editionId}:${d.kind}`;
}

// Per-window idempotency key. The 24h window keeps the legacy key format so
// subscribers already alerted about a deadline by the old daily cron aren't
// re-emailed when the hourly windows take over.
export function reminderKey(d: Deadline, windowHours: number): string {
  return windowHours === 24 ? deadlineKey(d) : `${deadlineKey(d)}:${windowHours}h`;
}

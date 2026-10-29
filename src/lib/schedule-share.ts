import type { ScheduleRow } from './types';

// What a shared /schedule?build=… link says in a preview card. Pure, so the
// wording is unit-tested; the page turns its editions into ShareStop[].

export type ShareStop = {
  name: string;
  city: string;
  level: string;
  start: string | null; // YYYY-MM-DD
  end: string | null;
};

// node-postgres gives `date` columns back as Date objects at local midnight.
export function isoDay(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

export function toShareStops(rows: ScheduleRow[]): ShareStop[] {
  return rows
    .map((e) => ({
      name: e.name.replace(/,\s*[A-Z]{2}$/, ''),
      city: e.city,
      level: e.level,
      start: isoDay(e.start_date as unknown as string | Date | null),
      end: isoDay(e.end_date as unknown as string | Date | null),
    }))
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
export function shortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

// "Nov 9–22, 2026" · "Nov 30 – Dec 13, 2026" · "Dec 28, 2026 – Jan 10, 2027"
export function dateSpan(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${shortDate(start)}, ${a.y} – ${shortDate(end)}, ${b.y}`;
  if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}–${b.d}, ${b.y}`;
  return `${shortDate(start)} – ${shortDate(end)}, ${b.y}`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// When a stop has no end date, assume the usual one-week event.
export function stopEnd(stop: ShareStop): string | null {
  if (stop.end) return stop.end;
  if (!stop.start) return null;
  const d = new Date(`${stop.start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function scheduleShareText(stops: ShareStop[]): { title: string; description: string } {
  if (stops.length === 0) {
    return { title: 'A tennis schedule · TennisCuts', description: 'Plan your season on TennisCuts.' };
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const route =
    stops.length <= 3
      ? stops.map((s) => s.name).join(' → ')
      : `${first.name} → ${last.name} (${stops.length} stops)`;
  const lastDay = stopEnd(last);
  const span = first.start && lastDay ? ` · ${dateSpan(first.start, lastDay)}` : '';
  const detail = stops
    .slice(0, 4)
    .map((s) => `${s.name} (${s.level}${s.start ? `, ${shortDate(s.start)}` : ''})`);
  const more = stops.length > 4 ? [`${stops.length - 4} more`] : [];
  const noun = stops.length === 1 ? 'A 1-stop tennis schedule' : `A ${stops.length}-stop tennis schedule`;
  return {
    title: `${route}${span}`,
    description: `${noun}: ${listNames([...detail, ...more])}. Entry cuts and travel days, planned on TennisCuts.`,
  };
}

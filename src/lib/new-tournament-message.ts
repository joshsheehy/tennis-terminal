// The Telegram message announcing tournaments that just appeared on the site.
// Pure, so the wording is testable without a database.

export type NewTournament = {
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  level: string;
  startDate: string; // YYYY-MM-DD
  year: number;
};

const MAX_LINES = 40;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** HTML for Telegram's sendMessage (parse_mode HTML), soonest first. */
export function newTournamentMessage(rows: NewTournament[], siteUrl: string): string {
  const sorted = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const count = sorted.length;
  const lines = [`🎾 <b>${count} new tournament${count === 1 ? '' : 's'} on TennisCuts</b>`, ''];
  for (const t of sorted.slice(0, MAX_LINES)) {
    const place = [t.city, t.country].filter(Boolean).join(', ');
    const link = `${siteUrl}/tournaments/${encodeURIComponent(t.slug)}?year=${t.year}`;
    lines.push(`${esc(day(t.startDate))} · ${esc(t.level)} · <a href="${link}">${esc(t.name)}</a>${place && place !== t.name ? ` (${esc(place)})` : ''}`);
  }
  if (count > MAX_LINES) lines.push(`…and ${count - MAX_LINES} more`);
  return lines.join('\n');
}

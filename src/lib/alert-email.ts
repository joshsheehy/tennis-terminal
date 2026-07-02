import { Deadline } from './entry-deadlines';

// Rendering for the entry-deadline alert email. Kept separate from the API
// route so it can be unit-tested and previewed without spinning up the server.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export type RenderedEmail = { subject: string; html: string; text: string };

// The draw is folded into the displayed name: main draw is just the tournament
// name, qualifying gets a "Qs" suffix, doubles gets "Doubles". The aggregate
// ITF row keeps its generic name.
export function displayName(d: Deadline): string {
  if (d.aggregate) return d.name;
  if (d.kind === 'qualifying') return `${d.name} Qs`;
  if (d.kind === 'doubles') return `${d.name} Doubles`;
  return d.name;
}

// Subtitle line under the name. Individual tournaments show level + place +
// start; the ITF aggregate summarises the week instead of listing every event.
// Grand Slam main-draw rows also carry the qualifying deadline date so both
// dates are visible at a glance.
function subtitle(d: Deadline): string {
  if (d.aggregate) {
    const n = d.tournamentCount ?? 0;
    const events = n > 0 ? `${n} tournaments` : 'all tournaments';
    return `${events} &middot; week of ${formatDate(d.tournamentStart)}`;
  }
  const place = d.country ? `${esc(d.city)}, ${esc(d.country)}` : esc(d.city);
  let line = `${esc(d.level)} &middot; ${place} &middot; starts ${formatDate(d.tournamentStart)}`;
  if (d.qualifyingDeadlineDate) {
    line += ` &middot; Qs deadline ${formatDate(d.qualifyingDeadlineDate)}`;
  }
  return line;
}

function textLine(d: Deadline): string {
  if (d.aggregate) {
    const n = d.tournamentCount ?? 0;
    const events = n > 0 ? `${n} tournaments` : 'all tournaments';
    return `- ITF World Tennis Tour (${events}, week of ${formatDate(d.tournamentStart)}) - entries close: ${formatDate(d.deadlineDate)} ${d.timeNote}.`;
  }
  const qs = d.qualifyingDeadlineDate
    ? ` Qs deadline ${formatDate(d.qualifyingDeadlineDate)}.`
    : '';
  return `- ${displayName(d)} (${d.level}) - ${formatDate(d.deadlineDate)} ${d.timeNote}. Tournament starts ${formatDate(d.tournamentStart)}.${qs}`;
}

// Build the subject + HTML + plain-text digest for a set of deadlines.
// `origin` is the site origin (used for the tournament, unsubscribe and
// preferences links); `unsubToken` is the subscriber's token.
export function renderDigest(
  deadlines: Deadline[],
  origin: string,
  unsubToken: string
): RenderedEmail {
  const count = deadlines.length;
  const soonest = deadlines[0];
  const subject =
    count === 1
      ? `Entry deadline tomorrow: ${displayName(soonest)}`
      : `${count} entry deadlines coming up`;

  // HTML entities (&middot;) instead of a raw · so the copy renders correctly
  // in every client regardless of how it interprets the charset.
  const rows = deadlines
    .map((d) => {
      // The ITF aggregate row has no single tournament page; link it to the
      // schedule instead.
      const url = d.aggregate
        ? `${origin}/cuts`
        : `${origin}/tournaments/${encodeURIComponent(d.slug)}`;
      return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee">
          <a href="${url}" style="color:#111;text-decoration:none;font-weight:600">${esc(displayName(d))}</a><br>
          <span style="color:#666;font-size:13px">${subtitle(d)}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;white-space:nowrap">
          <strong>${formatDate(d.deadlineDate)}</strong><br>
          <span style="color:#666;font-size:13px">${esc(d.timeNote)}</span>
        </td>
      </tr>`;
    })
    .join('');

  const unsubUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const manageUrl = `${origin}/alerts/manage?token=${encodeURIComponent(unsubToken)}`;
  const preheader =
    count === 1
      ? `${displayName(soonest)}: entry deadline is due within ~24 hours.`
      : `${count} entry deadlines are due within ~24 hours.`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Entry deadlines</title>
</head>
<body style="margin:0;background:#f6f7f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="margin:0 0 16px">
      <span style="font-size:20px;font-weight:700;color:#111">Tennis<span style="color:#3CB043">Cuts</span></span>
    </div>
    <h1 style="font-size:18px;margin:0 0 4px">Entry deadlines</h1>
    <p style="color:#555;font-size:14px;margin:0 0 16px">
      ${count === 1 ? 'A deadline is' : count + ' deadlines are'} due within about 24 hours. Times are shown as set by the governing body.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;font-size:14px">
      <thead>
        <tr style="background:#fafafa;text-align:left">
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em">Tournament</th>
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase">Deadline</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin:20px 0 0">
      <a href="${manageUrl}" style="display:inline-block;padding:8px 14px;border:1px solid #3CB043;border-radius:6px;color:#3CB043;text-decoration:none;font-size:13px;font-weight:600">Edit preferences</a>
      <a href="${unsubUrl}" style="display:inline-block;padding:8px 14px;border:1px solid #ddd;border-radius:6px;color:#888;text-decoration:none;font-size:13px;margin-left:6px">Unsubscribe</a>
    </div>
    <p style="color:#999;font-size:12px;margin:16px 0 0">
      You're receiving this because you signed up for Tennis Cuts alerts.
    </p>
  </div>
</body>
</html>`;

  // Plain text uses ASCII hyphens so no client can render a "weird character".
  const text =
    `Entry deadlines due within ~24 hours:\n\n` +
    deadlines.map(textLine).join('\n') +
    `\n\nEdit preferences: ${manageUrl}\nUnsubscribe: ${unsubUrl}\n\nTennis Cuts`;

  return { subject, html, text };
}

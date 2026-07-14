import { Category, CATEGORY_LABEL, Deadline, eventRank } from './entry-deadlines';

// Rendering for the alert + welcome emails. Kept separate from the API route so
// it can be unit-tested and previewed without spinning up the server.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function managePrefsUrl(origin: string, token: string): string {
  return `${origin}/alerts/manage?token=${encodeURIComponent(token)}`;
}

// Branded header shared by every email: the app logo next to the wordmark.
// The logo is a hosted PNG (email clients can't render local/data-URI images
// reliably); it loads once the recipient shows images. width/height are set so
// it reserves space and can't blow up if the client scales oddly.
function brandHeaderHtml(origin: string): string {
  return `<div style="margin:0 0 16px;line-height:1">
      <img src="${origin}/logo-mark.png" width="28" height="28" alt="Tennis Cuts" style="vertical-align:middle;margin-right:8px;border:0" />
      <span style="font-size:20px;font-weight:700;color:#111;vertical-align:middle">Tennis<span style="color:#3CB043">Cuts</span></span>
    </div>`;
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

// "in ~24 hours" / "in ~12 hours" / "in ~1 hour" — rounded to how a person
// would say it. Deadlines rendered without an hoursLeft (older callers, tests)
// fall back to the historical "~24 hours" copy.
export function timeLeftLabel(hoursLeft: number | undefined): string {
  if (hoursLeft == null) return '~24 hours';
  const h = Math.max(1, Math.round(hoursLeft));
  return h === 1 ? '~1 hour' : `~${h} hours`;
}

function soonestHours(deadlines: Deadline[]): number | undefined {
  const hours = deadlines.map((d) => d.hoursLeft).filter((h): h is number => h != null);
  return hours.length ? Math.min(...hours) : undefined;
}

// The draw is folded into the displayed name: main draw is just the tournament
// name, qualifying gets a "Qs" suffix, doubles gets "Doubles". The aggregate
// ITF row keeps its generic name.
export function displayName(d: Deadline): string {
  if (d.aggregate) return d.name;
  if (d.kind === 'qualifying') return `${d.name} Qs`;
  if (d.kind === 'doubles') return `${d.name} Doubles`;
  return d.name;
}

// Inside a sectioned digest the "Doubles" heading already says what the row
// is, so doubles rows drop the redundant name suffix there.
function sectionDisplayName(d: Deadline): string {
  return d.kind === 'doubles' ? d.name : displayName(d);
}

// The digest is split into a Singles section (main draw, qualifying, the ITF
// aggregate) and a Doubles section, each ordered by descending event level
// (Grand Slam -> ATP 1000 -> ... -> ITF); ties go to the soonest deadline.
export function splitDigestSections(
  deadlines: Deadline[]
): Array<{ title: string; deadlines: Deadline[] }> {
  const byLevel = (a: Deadline, b: Deadline) => {
    if (eventRank(a) !== eventRank(b)) return eventRank(a) - eventRank(b);
    if (a.deadlineDate !== b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
    return a.name.localeCompare(b.name);
  };
  const singles = deadlines.filter((d) => d.kind !== 'doubles').sort(byLevel);
  const doubles = deadlines.filter((d) => d.kind === 'doubles').sort(byLevel);
  const sections: Array<{ title: string; deadlines: Deadline[] }> = [];
  if (singles.length) sections.push({ title: 'Singles', deadlines: singles });
  if (doubles.length) sections.push({ title: 'Doubles', deadlines: doubles });
  return sections;
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
  const closing = d.hoursLeft != null ? ` (in ${timeLeftLabel(d.hoursLeft)})` : '';
  if (d.aggregate) {
    const n = d.tournamentCount ?? 0;
    const events = n > 0 ? `${n} tournaments` : 'all tournaments';
    return `- ITF World Tennis Tour (${events}, week of ${formatDate(d.tournamentStart)}) - entries close: ${formatDate(d.deadlineDate)} ${d.timeNote}${closing}.`;
  }
  const qs = d.qualifyingDeadlineDate
    ? ` Qs deadline ${formatDate(d.qualifyingDeadlineDate)}.`
    : '';
  return `- ${sectionDisplayName(d)} (${d.level}) - ${formatDate(d.deadlineDate)} ${d.timeNote}${closing}. Tournament starts ${formatDate(d.tournamentStart)}.${qs}`;
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
  const soonestLabel = timeLeftLabel(soonestHours(deadlines));
  const subject =
    count === 1
      ? `Entry deadline in ${soonestLabel}: ${displayName(soonest)}`
      : `${count} entry deadlines coming up`;

  // HTML entities (&middot;) instead of a raw · so the copy renders correctly
  // in every client regardless of how it interprets the charset.
  const rowHtml = (d: Deadline) => {
    // The ITF aggregate row has no single tournament page; link it to the
    // schedule instead.
    const url = d.aggregate
      ? `${origin}/cuts`
      : `${origin}/tournaments/${encodeURIComponent(d.slug)}`;
    const closing =
      d.hoursLeft != null
        ? `<br><span style="color:#b45309;font-size:13px;font-weight:600">closes in ${esc(timeLeftLabel(d.hoursLeft))}</span>`
        : '';
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee">
          <a href="${url}" style="color:#111;text-decoration:none;font-weight:600">${esc(sectionDisplayName(d))}</a><br>
          <span style="color:#666;font-size:13px">${subtitle(d)}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;white-space:nowrap">
          <strong>${formatDate(d.deadlineDate)}</strong><br>
          <span style="color:#666;font-size:13px">${esc(d.timeNote)}</span>${closing}
        </td>
      </tr>`;
  };

  const sections = splitDigestSections(deadlines);
  const sectionsHtml = sections
    .map(
      (s) => `
    <h2 style="font-size:14px;margin:20px 0 8px;color:#111;text-transform:uppercase;letter-spacing:.05em">${esc(s.title)}</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;font-size:14px">
      <thead>
        <tr style="background:#fafafa;text-align:left">
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em">Tournament</th>
          <th style="padding:8px 12px;font-size:12px;color:#888;text-transform:uppercase">Deadline</th>
        </tr>
      </thead>
      <tbody>${s.deadlines.map(rowHtml).join('')}</tbody>
    </table>`
    )
    .join('');

  const unsubUrl = unsubscribeUrl(origin, unsubToken);
  const manageUrl = managePrefsUrl(origin, unsubToken);
  const preheader =
    count === 1
      ? `${displayName(soonest)}: entry deadline is due in ${soonestLabel}.`
      : `${count} entry deadlines are due soon (closest in ${soonestLabel}).`;

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
    ${brandHeaderHtml(origin)}
    <h1 style="font-size:18px;margin:0 0 4px">Entry deadlines</h1>
    <p style="color:#555;font-size:14px;margin:0 0 16px">
      ${count === 1 ? `A deadline is due in ${esc(soonestLabel)}` : count + ` deadlines are due soon (closest in ${esc(soonestLabel)})`}. Times are shown as set by the governing body.
    </p>${sectionsHtml}
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
    `Entry deadlines due soon (closest in ${soonestLabel}):\n\n` +
    sections
      .map((s) => `${s.title.toUpperCase()}\n` + s.deadlines.map(textLine).join('\n'))
      .join('\n\n') +
    `\n\nEdit preferences: ${manageUrl}\nUnsubscribe: ${unsubUrl}\n\nTennis Cuts`;

  return { subject, html, text };
}

// One-time confirmation email sent the moment someone signs up. No action is
// required from them (single opt-in) — it just tells them they're subscribed,
// what they'll get, and how to change or stop it.
export function renderWelcome(opts: {
  origin: string;
  token: string;
  categories: Category[];
  includeDoubles: boolean;
}): RenderedEmail {
  const { origin, token, categories, includeDoubles } = opts;
  const unsubUrl = unsubscribeUrl(origin, token);
  const manageUrl = managePrefsUrl(origin, token);

  const catNames = categories.map((c) => CATEGORY_LABEL[c]);
  const listItems = catNames
    .map((n) => `<li style="margin:2px 0">${esc(n)}</li>`)
    .join('');
  const doublesLine = includeDoubles
    ? `<li style="margin:2px 0">Doubles (advance entry)</li>`
    : '';

  const subject = "You're subscribed to Tennis Cuts entry-deadline alerts";
  const preheader = "You're all set — we'll email you ~24 hours before each entry deadline.";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>You're subscribed</title>
</head>
<body style="margin:0;background:#f6f7f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    ${brandHeaderHtml(origin)}
    <h1 style="font-size:18px;margin:0 0 8px">You're subscribed &#9989;</h1>
    <p style="color:#333;font-size:14px;margin:0 0 12px;line-height:1.5">
      You'll get an email <strong>about 24 hours before</strong> each entry deadline for:
    </p>
    <ul style="color:#333;font-size:14px;margin:0 0 16px;padding-left:20px;line-height:1.5">
      ${listItems}${doublesLine}
    </ul>
    <p style="color:#555;font-size:13px;margin:0 0 20px;line-height:1.5">
      Singles main draw and qualifying are always included. Nothing else to do — no
      confirmation needed. Want to change tours or add doubles? Use the button below.
    </p>
    <div style="margin:0 0 20px">
      <a href="${manageUrl}" style="display:inline-block;padding:9px 16px;border:1px solid #3CB043;border-radius:6px;color:#3CB043;text-decoration:none;font-size:14px;font-weight:600">Edit preferences</a>
    </div>
    <p style="color:#999;font-size:12px;margin:0;line-height:1.5">
      You're receiving this because you signed up at ${esc(origin.replace(/^https?:\/\//, ''))}.
      <a href="${unsubUrl}" style="color:#999">Unsubscribe</a> anytime.
    </p>
  </div>
</body>
</html>`;

  const text =
    `You're subscribed to Tennis Cuts entry-deadline alerts.\n\n` +
    `You'll get an email about 24 hours before each entry deadline for:\n` +
    catNames.map((n) => `- ${n}`).join('\n') +
    (includeDoubles ? `\n- Doubles (advance entry)` : '') +
    `\n\nSingles main draw and qualifying are always included. No confirmation needed.\n\n` +
    `Edit preferences: ${manageUrl}\nUnsubscribe: ${unsubUrl}\n\nTennis Cuts`;

  return { subject, html, text };
}

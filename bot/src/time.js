// Timezone helpers — compute the UTC ms range for "today" in a given IANA tz.
// Used by both /today and the 9 PM cron summary so they agree on day bounds.

/**
 * Offset (local - UTC) in ms for the given instant in the given tz.
 */
function tzOffsetMs(tz, date) {
  // en-CA gives YYYY-MM-DD; we format the instant in the target tz, then read
  // it back as if it were UTC to recover the offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  // hour can be "24" at midnight in some locales — normalize to 0.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - date.getTime();
}

/**
 * Returns { startMs, endMs } in UTC for the local calendar day that `nowMs`
 * falls within, according to `tz`.
 */
export function localDayRange(tz, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = dateFmt.format(now).split('-').map(Number);

  // Local midnight expressed as if it were UTC, then shifted by the real offset
  // at that wall-clock moment.
  const guessUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMs(tz, new Date(guessUTC));
  const startMs = guessUTC - offset;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

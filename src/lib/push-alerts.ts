import { displayName, timeLeftLabel } from './alert-email';
import type { DueReminder } from './entry-deadlines';
import type { PushMessage } from './apns';

// The push version of the deadline digest email: one notification per hourly
// run per person, listing the deadlines that just entered one of their
// reminder windows. A lock-screen banner shows ~2 lines, so names are listed
// soonest-first and the rest folded into "+N more".

const MAX_NAMED = 3;

export function deadlinePushMessage(due: DueReminder[]): PushMessage | null {
  if (due.length === 0) return null;
  const sorted = [...due].sort((a, b) => a.hoursLeft - b.hoursLeft || a.name.localeCompare(b.name));
  const when = timeLeftLabel(sorted[0].hoursLeft);
  const title = sorted.length === 1 ? `Entry deadline in ${when}` : `${sorted.length} entry deadlines in ${when}`;
  const names = sorted.slice(0, MAX_NAMED).map(displayName);
  const extra = sorted.length - names.length;
  const body = extra > 0 ? `${names.join(', ')} +${extra} more` : names.join(', ');
  return {
    title,
    body,
    url: '/alerts',
    collapseId: `deadlines:${sorted.map((d) => d.editionId).join(',')}`,
  };
}

// Alert-send dedupe keys for push live in the same alert_sends log as email,
// prefixed so the two channels claim independently.
export function pushReminderKey(emailKey: string): string {
  return `push:${emailKey}`;
}

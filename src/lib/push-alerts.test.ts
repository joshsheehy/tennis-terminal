import { describe, expect, it } from 'vitest';
import type { DueReminder } from './entry-deadlines';
import { deadlinePushMessage, pushReminderKey } from './push-alerts';

function due(name: string, hoursLeft: number, kind = 'main', editionId = name): DueReminder {
  return {
    editionId,
    slug: name.toLowerCase(),
    name,
    city: name,
    country: null,
    level: 'Challenger 100',
    category: 'challenger',
    categoryLabel: 'ATP Challenger Tour',
    kind,
    kindLabel: kind,
    tournamentStart: '2026-11-16',
    daysPrior: 21,
    deadlineDate: '2026-10-26',
    deadlineAtIso: '2026-10-26T16:00:00Z',
    hoursLeft,
    dueWindows: [24],
  } as DueReminder;
}

describe('deadlinePushMessage', () => {
  it('returns nothing when no deadline is due', () => {
    expect(deadlinePushMessage([])).toBeNull();
  });

  it('names a single deadline with its time left', () => {
    const msg = deadlinePushMessage([due('Lille', 23.6)]);
    expect(msg).toMatchObject({ title: 'Entry deadline in ~24 hours', body: 'Lille', url: '/alerts' });
  });

  it('lists soonest first, labels qualifying, and folds the rest into +N more', () => {
    const msg = deadlinePushMessage([
      due('Brest', 20),
      due('Lille', 11.8, 'qualifying', 'lille-q'),
      due('Charlottesville', 23),
      due('Champaign', 22),
      due('Helsinki', 21),
    ])!;
    expect(msg.title).toBe('5 entry deadlines in ~12 hours');
    expect(msg.body).toBe('Lille Qs, Brest, Helsinki +2 more');
  });
});

describe('pushReminderKey', () => {
  it('keeps push claims separate from the email claim for the same deadline', () => {
    expect(pushReminderKey('abc:12h')).toBe('push:abc:12h');
  });
});

import { describe, expect, it } from 'vitest';
import { defaultPhase, groupSaved, phaseOf, relativeLabel, type SavedItem } from './saved-schedule';

const TODAY = '2026-10-27';

function item(id: string, start: string | null, end: string | null = null): SavedItem {
  return { editionId: id, slug: id, year: 2026, name: id, city: 'X', country: null, level: 'Challenger 100', start, end };
}

describe('phaseOf', () => {
  it('puts a tournament under way this week in current', () => {
    expect(phaseOf(item('a', '2026-10-26', '2026-11-01'), TODAY)).toBe('current');
  });
  it('counts the first and last day as current', () => {
    expect(phaseOf(item('a', '2026-10-27', '2026-11-02'), TODAY)).toBe('current');
    expect(phaseOf(item('a', '2026-10-21', '2026-10-27'), TODAY)).toBe('current');
  });
  it('splits upcoming from past', () => {
    expect(phaseOf(item('a', '2026-11-09', '2026-11-15'), TODAY)).toBe('upcoming');
    expect(phaseOf(item('a', '2026-10-12', '2026-10-18'), TODAY)).toBe('past');
  });
  it('assumes a week when the end date is missing', () => {
    expect(phaseOf(item('a', '2026-10-22'), TODAY)).toBe('current');
    expect(phaseOf(item('a', '2026-10-20'), TODAY)).toBe('past');
  });
  it('keeps undated tournaments visible under upcoming', () => {
    expect(phaseOf(item('a', null), TODAY)).toBe('upcoming');
  });
});

describe('relativeLabel', () => {
  it.each([
    ['2026-10-26', '2026-11-01', 'This week'],
    ['2026-10-28', '2026-11-03', 'Starts tomorrow'],
    ['2026-10-31', '2026-11-06', 'Starts in 4 days'],
    ['2026-11-02', '2026-11-08', 'Next week'],
    ['2026-11-16', '2026-11-22', 'In 3 weeks'],
    ['2027-02-01', '2027-02-07', 'In 3 months'],
    ['2026-10-19', '2026-10-25', 'Last week'],
    ['2026-09-21', '2026-09-27', '4 weeks ago'],
    ['2026-05-04', '2026-05-10', '6 months ago'],
    ['2025-11-10', '2025-11-16', 'Last year'],
    ['2023-11-06', '2023-11-12', '3 years ago'],
  ])('%s → %s is "%s"', (start, end, label) => {
    expect(relativeLabel(item('a', start, end), TODAY)).toBe(label);
  });
  it('says so when dates are unknown', () => {
    expect(relativeLabel(item('a', null), TODAY)).toBe('Dates TBD');
  });
});

describe('groupSaved', () => {
  const items = [
    item('past-old', '2025-11-10', '2025-11-16'),
    item('next', '2026-11-09', '2026-11-15'),
    item('now', '2026-10-26', '2026-11-01'),
    item('soon', '2026-11-02', '2026-11-08'),
    item('past-recent', '2026-10-12', '2026-10-18'),
  ];
  const groups = groupSaved(items, TODAY);

  it('orders upcoming soonest first and past most recent first', () => {
    expect(groups.current.map((i) => i.editionId)).toEqual(['now']);
    expect(groups.upcoming.map((i) => i.editionId)).toEqual(['soon', 'next']);
    expect(groups.past.map((i) => i.editionId)).toEqual(['past-recent', 'past-old']);
  });

  it('opens on current, then upcoming, then past', () => {
    expect(defaultPhase(groups)).toBe('current');
    expect(defaultPhase({ ...groups, current: [] })).toBe('upcoming');
    expect(defaultPhase({ current: [], upcoming: [], past: groups.past })).toBe('past');
    expect(defaultPhase({ current: [], upcoming: [], past: [] })).toBe('upcoming');
  });
});

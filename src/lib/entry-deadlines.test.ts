import { describe, expect, it } from 'vitest';
import {
  Category,
  categoryForLevel,
  deadlinesForEdition,
  dueDeadlines,
  mondayOfWeekUtc,
  normalizeCategoriesFromParam,
} from './entry-deadlines';
import { ScheduleRow } from './types';

function row(overrides: Partial<ScheduleRow>): ScheduleRow {
  return {
    edition_id: 'e1',
    tournament_id: 't1',
    slug: 'sample',
    name: 'Sample Open',
    city: 'Nowhere',
    country: 'USA',
    year: 2026,
    week: 1,
    start_date: '2026-03-16', // a Monday
    end_date: '2026-03-22',
    level: 'ATP 250',
    surface: 'Hard',
    indoor: false,
    source: 'test',
    status: 'held',
    ...overrides,
  };
}

describe('categoryForLevel', () => {
  it('maps levels to categories', () => {
    expect(categoryForLevel('ATP 250')).toBe('atp');
    expect(categoryForLevel('ATP 1000')).toBe('atp');
    expect(categoryForLevel('Challenger 75')).toBe('challenger');
    expect(categoryForLevel('Challenger')).toBe('challenger');
    expect(categoryForLevel('ITF M25')).toBe('itf');
    expect(categoryForLevel('Grand Slam')).toBe('grandslam');
    expect(categoryForLevel('Grand Slam Qualifying')).toBe('grandslam');
    expect(categoryForLevel('Exhibition')).toBeNull();
  });
});

describe('mondayOfWeekUtc', () => {
  it('returns the Monday on or before a date', () => {
    expect(mondayOfWeekUtc(new Date('2026-03-16T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-03-16'
    ); // already Monday
    expect(mondayOfWeekUtc(new Date('2026-03-18T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-03-16'
    ); // Wednesday -> back to Monday
    expect(mondayOfWeekUtc(new Date('2026-03-15T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-03-09'
    ); // Sunday -> previous Monday
  });
});

describe('deadlinesForEdition', () => {
  it('computes ATP Tour deadlines counted back from the Monday', () => {
    const ds = deadlinesForEdition(row({ level: 'ATP 500' }));
    const byKind = Object.fromEntries(ds.map((d) => [d.kind, d.deadlineDate]));
    // Monday 2026-03-16 minus 28 / 21 / 14 days.
    expect(byKind.main).toBe('2026-02-16');
    expect(byKind.qualifying).toBe('2026-02-23');
    expect(byKind.doubles).toBe('2026-03-02');
  });

  it('computes Challenger deadlines (21 / 19 / 7)', () => {
    const byKind = Object.fromEntries(
      deadlinesForEdition(row({ level: 'Challenger 100' })).map((d) => [d.kind, d.deadlineDate])
    );
    expect(byKind.main).toBe('2026-02-23'); // -21
    expect(byKind.qualifying).toBe('2026-02-25'); // -19
    expect(byKind.doubles).toBe('2026-03-09'); // -7
  });

  it('computes a single ITF entry deadline (18 days)', () => {
    const ds = deadlinesForEdition(row({ level: 'ITF M25' }));
    expect(ds).toHaveLength(1);
    expect(ds[0].kind).toBe('entry');
    expect(ds[0].deadlineDate).toBe('2026-02-26'); // -18
  });

  it('computes a Grand Slam main draw entry (42 days)', () => {
    const ds = deadlinesForEdition(row({ level: 'Grand Slam' }));
    expect(ds).toHaveLength(1);
    expect(ds[0].deadlineDate).toBe('2026-02-02'); // -42
  });

  it('returns nothing for uncovered levels', () => {
    expect(deadlinesForEdition(row({ level: 'Exhibition' }))).toHaveLength(0);
  });
});

describe('dueDeadlines', () => {
  const rows = [
    row({ edition_id: 'atp', level: 'ATP 250', start_date: '2026-03-16' }),
    row({ edition_id: 'itf', level: 'ITF M15', start_date: '2026-03-16' }),
  ];

  it('fires ~24h before (leadDays=1): the day before the deadline is in-window', () => {
    // ATP main deadline is 2026-02-16. Running on 2026-02-15 with lead 1 catches it.
    const due = dueDeadlines(rows, new Date('2026-02-15T09:00:00Z'), { leadDays: 1 });
    const keys = due.map((d) => `${d.category}:${d.kind}`);
    expect(keys).toContain('atp:main');
  });

  it('does not fire outside the lead window', () => {
    // Two days before the deadline, with lead 1, should NOT include it.
    const due = dueDeadlines(rows, new Date('2026-02-14T09:00:00Z'), { leadDays: 1 });
    expect(due.map((d) => d.kind)).not.toContain('main');
  });

  it('filters by chosen categories', () => {
    // ITF entry deadline is 2026-02-26; run the day before, ITF only.
    const due = dueDeadlines(rows, new Date('2026-02-25T09:00:00Z'), {
      leadDays: 1,
      categories: ['itf'],
    });
    expect(due).toHaveLength(1);
    expect(due[0].category).toBe('itf');
  });

  it('excludes doubles unless includeDoubles is set', () => {
    // ATP doubles deadline is 2026-03-02.
    const base = { leadDays: 1, categories: ['atp'] as Category[] };
    const without = dueDeadlines(rows, new Date('2026-03-01T09:00:00Z'), { ...base });
    expect(without.map((d) => d.kind)).not.toContain('doubles');
    const withDbl = dueDeadlines(rows, new Date('2026-03-01T09:00:00Z'), {
      ...base,
      includeDoubles: true,
    });
    expect(withDbl.map((d) => d.kind)).toContain('doubles');
  });
});

describe('normalizeCategoriesFromParam', () => {
  it('parses a comma list and drops junk', () => {
    expect(normalizeCategoriesFromParam('atp,itf,bogus')).toEqual(['atp', 'itf']);
  });
  it('falls back to all categories when empty', () => {
    expect(normalizeCategoriesFromParam(null)).toEqual(['atp', 'challenger', 'itf', 'grandslam']);
  });
});

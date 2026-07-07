import { describe, expect, it } from 'vitest';
import {
  Category,
  categoryForLevel,
  deadlinesForEdition,
  dueDeadlines,
  eventRank,
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

  it('computes Grand Slam main / qualifying / doubles (42 / 28 / 14)', () => {
    const ds = deadlinesForEdition(row({ level: 'Grand Slam' }));
    const byKind = Object.fromEntries(ds.map((d) => [d.kind, d.deadlineDate]));
    expect(ds).toHaveLength(3);
    expect(byKind.main).toBe('2026-02-02'); // -42
    expect(byKind.qualifying).toBe('2026-02-16'); // -28
    expect(byKind.doubles).toBe('2026-03-02'); // -14
  });

  it('puts the qualifying deadline date on the Grand Slam main-draw row only', () => {
    const ds = deadlinesForEdition(row({ level: 'Grand Slam' }));
    const main = ds.find((d) => d.kind === 'main');
    const quali = ds.find((d) => d.kind === 'qualifying');
    expect(main?.qualifyingDeadlineDate).toBe('2026-02-16');
    expect(quali?.qualifyingDeadlineDate).toBeUndefined();
    // Not a Grand Slam thing for other tours.
    const atpMain = deadlinesForEdition(row({ level: 'ATP 250' })).find((d) => d.kind === 'main');
    expect(atpMain?.qualifyingDeadlineDate).toBeUndefined();
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

  it('collapses ITF events sharing a week into one aggregate row', () => {
    const manyItf = [
      row({ edition_id: 'i1', slug: 'itf-a', name: 'ITF A', level: 'ITF M15' }),
      row({ edition_id: 'i2', slug: 'itf-b', name: 'ITF B', level: 'ITF M25' }),
      row({ edition_id: 'i3', slug: 'itf-c', name: 'ITF C', level: 'ITF M15' }),
    ];
    const due = dueDeadlines(manyItf, new Date('2026-02-25T09:00:00Z'), {
      leadDays: 1,
      categories: ['itf'],
    });
    expect(due).toHaveLength(1);
    expect(due[0].aggregate).toBe(true);
    expect(due[0].tournamentCount).toBe(3);
    expect(due[0].name).toBe('ITF World Tennis Tour');
    // Stable dedupe key derives from the week, not any single edition.
    expect(due[0].editionId).toBe('itf-week-2026-03-16');
  });

  it('excludes ATP/Challenger doubles unless includeDoubles is set', () => {
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

  it('excludes Grand Slam doubles unless includeDoubles is set (opt-in)', () => {
    const gs = [row({ edition_id: 'gs', slug: 'wimbledon', name: 'Wimbledon', level: 'Grand Slam' })];
    // GS doubles deadline is 2026-03-02; run the day before.
    const when = new Date('2026-03-01T09:00:00Z');
    const without = dueDeadlines(gs, when, { leadDays: 1, categories: ['grandslam'] });
    expect(without.map((d) => d.kind)).not.toContain('doubles');
    const withDbl = dueDeadlines(gs, when, {
      leadDays: 1,
      categories: ['grandslam'],
      includeDoubles: true,
    });
    expect(withDbl.map((d) => d.kind)).toContain('doubles');
  });

  it('fires separate alerts for Grand Slam main draw and qualifying', () => {
    const gs = [row({ edition_id: 'gs', slug: 'wimbledon', name: 'Wimbledon', level: 'Grand Slam' })];
    // Main deadline 2026-02-02: due when run on 2026-02-01.
    const mainDue = dueDeadlines(gs, new Date('2026-02-01T09:00:00Z'), {
      leadDays: 1,
      categories: ['grandslam'],
    });
    expect(mainDue.map((d) => d.kind)).toEqual(['main']);
    // Qualifying deadline 2026-02-16: due when run on 2026-02-15.
    const qualiDue = dueDeadlines(gs, new Date('2026-02-15T09:00:00Z'), {
      leadDays: 1,
      categories: ['grandslam'],
    });
    expect(qualiDue.map((d) => d.kind)).toEqual(['qualifying']);
  });

  it('orders the digest by prestige: GS, Masters 1000, other ATP, Challenger, ITF', () => {
    const rows = [
      row({ edition_id: 'itf', slug: 'itf1', name: 'ITF One', level: 'ITF M25', start_date: '2026-07-27' }),
      row({ edition_id: 'ch', slug: 'ch1', name: 'Challenger One', level: 'Challenger 100', start_date: '2026-07-27' }),
      row({ edition_id: 'a250', slug: 'a250', name: 'ATP 250 One', level: 'ATP 250', start_date: '2026-07-27' }),
      row({ edition_id: 'm1000', slug: 'm1000', name: 'Masters One', level: 'ATP 1000', start_date: '2026-07-27' }),
      row({ edition_id: 'gs', slug: 'gs1', name: 'Slam One', level: 'Grand Slam', start_date: '2026-07-27' }),
    ];
    // Wide window so every tier's deadline is in-range, isolating the ordering.
    const due = dueDeadlines(rows, new Date('2026-05-01T09:00:00Z'), {
      leadDays: 90,
      categories: ['grandslam', 'atp', 'challenger', 'itf'],
    });
    const ranks = due.map(eventRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b)); // non-decreasing
    expect(due[0].category).toBe('grandslam');
    expect(due[due.length - 1].category).toBe('itf');
    // Masters 1000 precedes other ATP.
    const idx = (name: string) => due.findIndex((d) => d.name === name);
    expect(idx('Masters One')).toBeLessThan(idx('ATP 250 One'));
  });

  it('ranks by category then numeric level (higher level first)', () => {
    const mk = (level: string) => deadlinesForEdition(row({ level }))[0];
    const order = [
      'Grand Slam',
      'ATP 1000',
      'ATP 500',
      'ATP 250',
      'Challenger 175',
      'Challenger 125',
      'Challenger 100',
      'Challenger 75',
      'Challenger 50',
      'ITF M25',
      'ITF M15',
    ].map((lvl) => eventRank(mk(lvl)));
    // Strictly increasing rank across the whole prestige ladder.
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
    // The specific example from the request: Challenger 125 outranks 75.
    expect(eventRank(mk('Challenger 125'))).toBeLessThan(eventRank(mk('Challenger 75')));
  });

  it('sorts same-tour events by level within the digest (Ch 125 above Ch 75)', () => {
    const rows = [
      row({ edition_id: 'c75', slug: 'c75', name: 'Small Challenger', level: 'Challenger 75', start_date: '2026-07-27' }),
      row({ edition_id: 'c125', slug: 'c125', name: 'Big Challenger', level: 'Challenger 125', start_date: '2026-07-27' }),
    ];
    const due = dueDeadlines(rows, new Date('2026-05-01T09:00:00Z'), {
      leadDays: 90,
      categories: ['challenger'],
    });
    const names = due.map((d) => d.name);
    expect(names.indexOf('Big Challenger')).toBeLessThan(names.indexOf('Small Challenger'));
  });

  it('sorts Grand Slams to the top even when other deadlines are sooner', () => {
    const mixed = [
      // ATP qualifying deadline 2026-02-23 (sooner).
      row({ edition_id: 'atp2', slug: 'acapulco', name: 'Acapulco', level: 'ATP 500' }),
      // GS qualifying deadline 2026-02-16 base... use a GS whose deadline is
      // LATER than the ATP one to prove category outranks date:
      // start 2026-03-23 -> quali deadline = -28 = 2026-02-23 (same day).
      row({
        edition_id: 'gs2',
        slug: 'roland-garros',
        name: 'Roland Garros',
        level: 'Grand Slam',
        start_date: '2026-03-23',
      }),
    ];
    const due = dueDeadlines(mixed, new Date('2026-02-22T09:00:00Z'), {
      leadDays: 1,
      categories: ['atp', 'grandslam'],
    });
    expect(due.length).toBeGreaterThanOrEqual(2);
    expect(due[0].category).toBe('grandslam');
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

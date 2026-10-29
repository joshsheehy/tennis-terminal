import { describe, expect, it } from 'vitest';
import { dateSpan, scheduleShareText, type ShareStop } from './schedule-share';

const stop = (name: string, start: string, end: string, level = 'Challenger 75'): ShareStop => ({
  name, city: name, level, start, end,
});

describe('dateSpan', () => {
  it('compacts a span within one month', () => {
    expect(dateSpan('2026-11-09', '2026-11-22')).toBe('Nov 9–22, 2026');
  });
  it('names both months across a month boundary', () => {
    expect(dateSpan('2026-11-30', '2026-12-13')).toBe('Nov 30 – Dec 13, 2026');
  });
  it('names both years across New Year', () => {
    expect(dateSpan('2026-12-28', '2027-01-10')).toBe('Dec 28, 2026 – Jan 10, 2027');
  });
});

describe('scheduleShareText', () => {
  it('reads as a route with dates and lists the stops', () => {
    const t = scheduleShareText([
      stop('Knoxville', '2026-11-09', '2026-11-15'),
      stop('Champaign', '2026-11-16', '2026-11-22', 'Challenger 50'),
    ]);
    expect(t.title).toBe('Knoxville → Champaign · Nov 9–22, 2026');
    expect(t.description).toBe(
      'A 2-stop tennis schedule: Knoxville (Challenger 75, Nov 9) and Champaign (Challenger 50, Nov 16). Entry cuts and travel days, planned on TennisCuts.'
    );
  });

  it('shortens long swings to first → last with a count', () => {
    const t = scheduleShareText([
      stop('A', '2026-01-05', '2026-01-11'),
      stop('B', '2026-01-12', '2026-01-18'),
      stop('C', '2026-01-19', '2026-01-25'),
      stop('D', '2026-01-26', '2026-02-01'),
      stop('E', '2026-02-02', '2026-02-08'),
    ]);
    expect(t.title).toBe('A → E (5 stops) · Jan 5 – Feb 8, 2026');
    expect(t.description).toContain('and 1 more.');
  });

  it('handles a single stop and an empty list', () => {
    expect(scheduleShareText([stop('Lille', '2026-11-09', '2026-11-15')]).description).toMatch(/^A 1-stop tennis schedule: Lille/);
    expect(scheduleShareText([]).title).toBe('A tennis schedule · TennisCuts');
  });

  it('assumes a one-week event when the last stop has no end date', () => {
    const t = scheduleShareText([
      stop('Knoxville', '2026-11-09', '2026-11-15'),
      { name: 'Champaign', city: 'Champaign', level: 'Challenger 50', start: '2026-11-16', end: null },
    ]);
    expect(t.title).toBe('Knoxville → Champaign · Nov 9–22, 2026');
  });
});

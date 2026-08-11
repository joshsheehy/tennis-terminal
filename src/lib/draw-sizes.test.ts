import { describe, it, expect } from 'vitest';
import { parseCsvLine, parseSackmannDrawSizes } from './draw-sizes';

const HEADER =
  'tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,round';

const row = (o: {
  id: string;
  name?: string;
  size: number | string;
  level: string;
  date?: string;
  round: string;
}) =>
  [
    o.id,
    o.name ?? 'Somewhere',
    'Clay',
    o.size,
    o.level,
    o.date ?? '20240415',
    '1',
    o.round,
  ].join(',');

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseCsvLine', () => {
  it('splits plain fields', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted fields, which tourney_name contains', () => {
    expect(parseCsvLine('2024-0451,"Rio de Janeiro, BR",Clay')).toEqual([
      '2024-0451',
      'Rio de Janeiro, BR',
      'Clay',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });
});

describe('parseSackmannDrawSizes', () => {
  it('separates the main draw from the qualifying draw by round', () => {
    const text = csv(
      row({ id: '2024-0451', size: 48, level: 'C', round: 'R32' }),
      row({ id: '2024-0451', size: 16, level: 'C', round: 'Q1' }),
      row({ id: '2024-0451', size: 16, level: 'C', round: 'Q2' })
    );
    const [t] = parseSackmannDrawSizes(text, ['C']);
    expect(t.mainDrawSize).toBe(48);
    expect(t.qualifyingDrawSize).toBe(16);
  });

  it('captures the 56 vs 96 split that the per-level default flattens', () => {
    const text = csv(
      row({ id: '2024-0403', name: 'Miami', size: 96, level: 'M', round: 'R128' }),
      row({ id: '2024-0410', name: 'Monte Carlo', size: 56, level: 'M', round: 'R64' })
    );
    const sizes = parseSackmannDrawSizes(text, ['A', 'M']);
    expect(sizes.map((s) => s.mainDrawSize).sort((a, b) => a! - b!)).toEqual([56, 96]);
  });

  it('filters by tourney_level', () => {
    const text = csv(
      row({ id: '2024-0451', size: 48, level: 'C', round: 'R32' }),
      row({ id: '2024-0300', size: 32, level: 'A', round: 'R32' })
    );
    expect(parseSackmannDrawSizes(text, ['C'])).toHaveLength(1);
    expect(parseSackmannDrawSizes(text, ['A', 'M'])).toHaveLength(1);
  });

  it('parses the tournament code out of tourney_id, dropping leading zeros', () => {
    const text = csv(row({ id: '2024-0451', size: 32, level: 'C', round: 'R32' }));
    expect(parseSackmannDrawSizes(text, ['C'])[0].code).toBe(451);
  });

  it('takes the largest size seen, so one stale row cannot shrink a draw', () => {
    const text = csv(
      row({ id: '2024-0451', size: 32, level: 'C', round: 'R32' }),
      row({ id: '2024-0451', size: 48, level: 'C', round: 'R16' })
    );
    expect(parseSackmannDrawSizes(text, ['C'])[0].mainDrawSize).toBe(48);
  });

  it('leaves a draw null when the file has no rows for it', () => {
    const text = csv(row({ id: '2024-0451', size: 32, level: 'C', round: 'R32' }));
    expect(parseSackmannDrawSizes(text, ['C'])[0].qualifyingDrawSize).toBeNull();
  });

  it('skips rows with an unusable date, size or id', () => {
    const text = csv(
      row({ id: '2024-0451', size: 'n/a', level: 'C', round: 'R32' }),
      row({ id: 'garbage', size: 32, level: 'C', round: 'R32' }),
      row({ id: '2024-0452', size: 32, level: 'C', date: 'nope', round: 'R32' })
    );
    expect(parseSackmannDrawSizes(text, ['C'])).toEqual([]);
  });

  it('returns empty for an empty file rather than throwing', () => {
    expect(parseSackmannDrawSizes('', ['C'])).toEqual([]);
  });

  it('throws when the expected columns are absent', () => {
    expect(() => parseSackmannDrawSizes('a,b,c\n1,2,3', ['C'])).toThrow(/Missing expected/);
  });

  it('sorts by start date', () => {
    const text = csv(
      row({ id: '2024-2', size: 32, level: 'C', date: '20240601', round: 'R32' }),
      row({ id: '2024-1', size: 32, level: 'C', date: '20240101', round: 'R32' })
    );
    expect(parseSackmannDrawSizes(text, ['C']).map((t) => t.startDate)).toEqual([
      '2024-01-01',
      '2024-06-01',
    ]);
  });
});

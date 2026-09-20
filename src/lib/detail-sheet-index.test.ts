import { describe, it, expect } from 'vitest';
import {
  buildDetailSheetIndex,
  filterDetailSheets,
  tournamentDisplayName,
  type DetailSheetEdition,
} from './detail-sheet-index';

function edition(overrides: Partial<DetailSheetEdition>): DetailSheetEdition {
  return {
    slug: 'zz-some-slug',
    name: 'Some Open',
    city: 'Somewhere',
    country: 'Spain',
    year: 2026,
    level: 'Challenger 75',
    source_url: 'https://www.protennislive.com/posting/2026/9001/mds.pdf',
    ...overrides,
  };
}

describe('buildDetailSheetIndex', () => {
  it('lists tournaments alphabetically, ignoring case and accents', () => {
    const index = buildDetailSheetIndex([
      edition({ slug: 'zz-zagreb', name: 'Zagreb Open', source_url: 'https://www.protennislive.com/posting/2026/9010/mds.pdf' }),
      edition({ slug: 'zz-a', name: 'Águilas Challenger', source_url: 'https://www.protennislive.com/posting/2026/9011/mds.pdf' }),
      edition({ slug: 'zz-b', name: 'bari', source_url: 'https://www.protennislive.com/posting/2026/9012/mds.pdf' }),
    ]);
    expect(index.map((e) => e.name)).toEqual(['Águilas Challenger', 'bari', 'Zagreb Open']);
  });

  it('sorts numbered events in numeric order', () => {
    const index = buildDetailSheetIndex([
      edition({ slug: 'zz-p10', name: 'Plovdiv 10', source_url: 'https://www.protennislive.com/posting/2026/9020/mds.pdf' }),
      edition({ slug: 'zz-p2', name: 'Plovdiv 2', source_url: 'https://www.protennislive.com/posting/2026/9021/mds.pdf' }),
    ]);
    expect(index.map((e) => e.name)).toEqual(['Plovdiv 2', 'Plovdiv 10']);
  });

  it('makes one row per tournament with a link for every year, newest first', () => {
    const index = buildDetailSheetIndex([
      edition({ slug: 'zz-sion', name: 'Sion', year: 2024, source_url: 'https://www.protennislive.com/posting/2024/9030/mds.pdf' }),
      edition({ slug: 'zz-sion', name: 'Sion', year: 2026, source_url: 'https://www.protennislive.com/posting/2026/9030/mds.pdf' }),
      edition({ slug: 'zz-sion', name: 'Sion', year: 2025, source_url: null }),
    ]);
    expect(index).toHaveLength(1);
    expect(index[0].code).toBe('9030');
    expect(index[0].sheets.map((s) => s.year)).toEqual([2026, 2025, 2024]);
    expect(index[0].sheets[0].url).toBe('https://www.protennislive.com/posting/2026/9030/ds.pdf');
  });

  it('finds a code carried only on a cut snapshot', () => {
    const index = buildDetailSheetIndex(
      [edition({ slug: 'zz-vendee', name: 'Open de Vendée', source_url: null })],
      [{ slug: 'zz-vendee', url: 'https://www.protennislive.com/posting/2025/6857/mds.pdf' }]
    );
    expect(index).toHaveLength(1);
    expect(index[0].code).toBe('6857');
  });

  it('leaves out tournaments with no code, and levels that have no detail sheet', () => {
    const index = buildDetailSheetIndex([
      edition({ slug: 'zz-no-code', name: 'No Code Open', source_url: null }),
      edition({ slug: 'zz-itf', name: 'M25 Antalya', level: 'ITF M25' }),
      edition({ slug: 'zz-slam', name: 'Wimbledon', level: 'Grand Slam' }),
      edition({ slug: 'zz-ok', name: 'Fine Open', level: 'ATP 250', source_url: 'https://www.protennislive.com/posting/2026/9040/mds.pdf' }),
    ]);
    expect(index.map((e) => e.name)).toEqual(['Fine Open']);
  });

  it('shows the place and drops a US state suffix from the name', () => {
    const index = buildDetailSheetIndex([
      edition({ slug: 'zz-tiburon', name: 'Tiburon, CA', city: 'Tiburon', country: 'United States', source_url: 'https://www.protennislive.com/posting/2026/9050/mds.pdf' }),
    ]);
    expect(index[0].name).toBe('Tiburon');
    expect(index[0].place).toBe('Tiburon, United States');
    expect(tournamentDisplayName('Genoa (Park Tennis Training)')).toBe('Genoa (Park Tennis Training)');
  });
});

describe('filterDetailSheets', () => {
  const entries = buildDetailSheetIndex([
    edition({ slug: 'zz-bari', name: 'Bari', city: 'Bari', country: 'Italy', level: 'Challenger 50', source_url: 'https://www.protennislive.com/posting/2026/9060/mds.pdf' }),
    edition({ slug: 'zz-cordoba', name: 'Córdoba', city: 'Córdoba', country: 'Argentina', level: 'ATP 250', source_url: 'https://www.protennislive.com/posting/2026/9061/mds.pdf' }),
    edition({ slug: 'zz-genoa', name: 'Genoa', city: 'Genoa', country: 'Italy', level: 'Challenger 75', source_url: 'https://www.protennislive.com/posting/2026/9062/mds.pdf' }),
  ]);

  it('returns everything for an empty search', () => {
    expect(filterDetailSheets(entries, '   ')).toHaveLength(3);
  });

  it('matches without caring about case or accents', () => {
    expect(filterDetailSheets(entries, 'CORDOBA').map((e) => e.slug)).toEqual(['zz-cordoba']);
    expect(filterDetailSheets(entries, 'córdoba').map((e) => e.slug)).toEqual(['zz-cordoba']);
  });

  it('matches on country and level, and needs every word', () => {
    expect(filterDetailSheets(entries, 'italy').map((e) => e.slug)).toEqual(['zz-bari', 'zz-genoa']);
    expect(filterDetailSheets(entries, 'italy 75').map((e) => e.slug)).toEqual(['zz-genoa']);
    expect(filterDetailSheets(entries, 'italy atp')).toEqual([]);
  });

  it('matches the ProTennisLive code', () => {
    expect(filterDetailSheets(entries, '9062').map((e) => e.slug)).toEqual(['zz-genoa']);
  });
});

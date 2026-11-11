import { describe, expect, it } from 'vitest';
import { findSameWeekDuplicates, placeKey, type WeekEdition } from './same-week-duplicates';

function ed(slug: string, name: string, city: string, level: string, weekStart = '2027-01-18'): WeekEdition {
  return {
    edition_id: slug,
    slug,
    name,
    city,
    country: 'United States',
    year: 2027,
    week_start: weekStart,
    start_date: weekStart,
    level,
    source: null,
    cuts: 0,
  };
}

describe('placeKey', () => {
  it('drops event numbers, state codes, brackets and accents', () => {
    expect(placeKey('San Diego 1, CA')).toBe('sandiego');
    expect(placeKey('San Diego, CA')).toBe('sandiego');
    expect(placeKey('Bogotá (Los Lagartos)')).toBe('bogota');
    expect(placeKey('Tigre 2')).toBe('tigre');
    expect(placeKey('Chișinău')).toBe('chisinau');
  });
});

describe('findSameWeekDuplicates', () => {
  it('flags the two San Diego Open rows in the week of 18 January 2027', () => {
    const groups = findSameWeekDuplicates([
      ed('san-diego-1', 'San Diego 1, CA', 'San Diego 1', 'Challenger 75'),
      ed('san-diego-ca-san-diego', 'San Diego, CA', 'San Diego', 'Challenger 75'),
      ed('koblenz-koblenz', 'Koblenz', 'Koblenz', 'Challenger 75'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].editions.map((e) => e.slug)).toEqual(['san-diego-1', 'san-diego-ca-san-diego']);
  });

  it('leaves different cities at the same level alone', () => {
    expect(
      findSameWeekDuplicates([
        ed('itajai-itajai', 'Itajaí', 'Itajaí', 'Challenger 75'),
        ed('koblenz-koblenz', 'Koblenz', 'Koblenz', 'Challenger 75'),
      ])
    ).toEqual([]);
  });

  it('leaves the same city in different weeks alone (San Diego 1 and 2)', () => {
    expect(
      findSameWeekDuplicates([
        ed('san-diego-ca-san-diego', 'San Diego, CA', 'San Diego', 'Challenger 75', '2027-01-18'),
        ed('san-diego-2', 'San Diego 2, CA', 'San Diego', 'Challenger 75', '2027-01-25'),
      ])
    ).toEqual([]);
  });

  it('ignores ITF events, which run several a week in one city', () => {
    expect(
      findSameWeekDuplicates([
        ed('itf-a', 'M15 Monastir', 'Monastir', 'ITF M15'),
        ed('itf-b', 'M15 Monastir 2', 'Monastir', 'ITF M15'),
      ])
    ).toEqual([]);
  });
});

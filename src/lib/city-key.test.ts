import { describe, expect, it } from 'vitest';
import { cityKey, cityKeySql, sameCity } from './city-key';

describe('cityKey', () => {
  // The case that cost real history: one feed hyphenates, another does not, so
  // three tournament records survived for one Challenger and its cut history
  // was split between them.
  it('folds hyphens and spaces to the same key', () => {
    expect(cityKey('Mouilleron-le-Captif')).toBe(cityKey('Mouilleron le Captif'));
  });

  it('folds accents', () => {
    expect(cityKey('Málaga')).toBe('malaga');
    expect(cityKey('Zürich')).toBe('zurich');
    expect(cityKey('İstanbul'.normalize('NFD'))).toContain('stanbul');
  });

  it('folds case and punctuation', () => {
    expect(cityKey("L'Aquila")).toBe('laquila');
    expect(cityKey('Baton Rouge, LA')).toBe('batonrougela');
  });

  it('keeps genuinely different cities apart', () => {
    expect(cityKey('Prague')).not.toBe(cityKey('Bratislava'));
    expect(cityKey('Cancun')).not.toBe(cityKey('Cannes'));
  });

  it('is empty for a missing city, so nothing groups on absence', () => {
    expect(cityKey(null)).toBe('');
    expect(cityKey(undefined)).toBe('');
    expect(cityKey('  ')).toBe('');
  });
});

describe('sameCity', () => {
  it('matches across spellings', () => {
    expect(sameCity('Mouilleron-le-Captif', 'Mouilleron le Captif')).toBe(true);
  });

  it('never matches two blanks, which would group every city without one', () => {
    expect(sameCity(null, null)).toBe(false);
    expect(sameCity('', '')).toBe(false);
  });
});

describe('cityKeySql', () => {
  it('folds through the same steps the function does', () => {
    const sql = cityKeySql('t.city');
    expect(sql).toContain('lower(t.city)');
    expect(sql).toContain('translate(');
    expect(sql).toContain(`'[^a-z0-9]+'`);
  });

  it('pairs every accented character with a replacement', () => {
    // A translate() whose two arguments differ in length silently drops
    // characters, which would fold unrelated cities together.
    const [, accented, plain] = cityKeySql('c').match(/translate\(lower\(c\), '([^']*)', '([^']*)'\)/) ?? [];
    expect(accented).toBeDefined();
    expect([...(accented ?? [])].length).toBe([...(plain ?? [])].length);
  });
});

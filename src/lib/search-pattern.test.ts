import { describe, expect, it } from 'vitest';
import { searchPattern } from './search-pattern';

describe('searchPattern', () => {
  it('wraps the trimmed text for a contains match', () => {
    expect(searchPattern('  San  Diego ')).toBe('%San Diego%');
  });
  it('treats % _ and backslash as literal characters', () => {
    expect(searchPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('ignores input too short or not text', () => {
    expect(searchPattern('a')).toBeNull();
    expect(searchPattern('   ')).toBeNull();
    expect(searchPattern(undefined)).toBeNull();
    expect(searchPattern(42)).toBeNull();
  });
  it('caps very long input', () => {
    expect(searchPattern('x'.repeat(500))!.length).toBe(62);
  });
});

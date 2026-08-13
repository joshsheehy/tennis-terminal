import { describe, expect, it } from 'vitest';
import {
  codeAllowedAtLevel,
  codeBreakdown,
  entryCodeLabel,
  numberIsAtpRanking,
  rankingDisplay,
} from './entry-codes';

describe('numberIsAtpRanking', () => {
  it('is false for the two pathways drawn from another ranking system', () => {
    expect(numberIsAtpRanking('JR')).toBe(false);
    expect(numberIsAtpRanking('CO')).toBe(false);
  });

  it('is true for Next Gen, which requires an ATP ranking inside the top 500', () => {
    expect(numberIsAtpRanking('NG')).toBe(true);
  });

  it('is true for wildcards, protected rankings and plain direct acceptances', () => {
    expect(numberIsAtpRanking('WC')).toBe(true);
    expect(numberIsAtpRanking('PR')).toBe(true);
    expect(numberIsAtpRanking(null)).toBe(true);
  });
});

describe('rankingDisplay', () => {
  it('shows the code alone when the number is a junior or collegiate ranking', () => {
    // Kingston lists its junior accelerators at 11 and 19 — ITF junior
    // rankings, in a field of players ranked 150-350.
    expect(rankingDisplay(11, 'JR')).toBe('JR');
    expect(rankingDisplay(10, 'CO')).toBe('CO');
  });

  it('keeps the ATP ranking and names the route where both are real', () => {
    expect(rankingDisplay(213, 'NG')).toBe('213 NG');
    expect(rankingDisplay(56, 'PR')).toBe('56 PR');
  });

  it('shows a bare ranking for a direct acceptance', () => {
    expect(rankingDisplay(78, null)).toBe('78');
  });

  it('falls back to the code when there is no number at all', () => {
    expect(rankingDisplay(null, 'WC')).toBe('WC');
    expect(rankingDisplay(null, null)).toBe('');
  });

  it('ignores a code it does not recognise rather than printing noise', () => {
    expect(rankingDisplay(200, 'ZZ')).toBe('200');
  });
});

describe('codeAllowedAtLevel', () => {
  it('confines the junior and college pathways to Challenger 50 and 75', () => {
    expect(codeAllowedAtLevel('JR', 'CH 75')).toBe(true);
    expect(codeAllowedAtLevel('CO', 'CH 50')).toBe(true);
    expect(codeAllowedAtLevel('JR', 'CH 125')).toBe(false);
    expect(codeAllowedAtLevel('CO', 'CH 125')).toBe(false);
  });

  it('allows Next Gen across the Challenger levels', () => {
    expect(codeAllowedAtLevel('NG', 'CH 125')).toBe(true);
    expect(codeAllowedAtLevel('NG', 'CH 50')).toBe(true);
  });

  it('does not constrain codes that have no level rule', () => {
    expect(codeAllowedAtLevel('WC', 'CH 125')).toBe(true);
    expect(codeAllowedAtLevel(null, 'CH 125')).toBe(true);
  });
});

describe('codeBreakdown', () => {
  it('counts only coded entries, in a fixed order', () => {
    expect(codeBreakdown(['NG', null, 'PR', 'NG', null])).toEqual([
      { code: 'PR', count: 1 },
      { code: 'NG', count: 2 },
    ]);
  });

  it('is empty when every acceptance came off the ranking list', () => {
    expect(codeBreakdown([null, null])).toEqual([]);
  });
});

describe('entryCodeLabel', () => {
  it('spells out what the code means', () => {
    expect(entryCodeLabel('NG')).toBe('Next Gen Accelerator');
    expect(entryCodeLabel('JR')).toMatch(/ITF junior ranking/);
    expect(entryCodeLabel('nope')).toBeNull();
  });
});

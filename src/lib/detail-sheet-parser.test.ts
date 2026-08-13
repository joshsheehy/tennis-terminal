import { describe, expect, it } from 'vitest';
import { drawAddsUp, parseDetailSheetText, parseSheetCell, parseSheetPair } from './detail-sheet-parser';

// Rows exactly as they extract from the posted PDFs for the Aug 17, 2026 week.
const PRAGUE = [
  'PRAGUE, CZECHIA (600)',
  '17 - 22 AUGUST 2026 (SATURDAY FINAL)',
  'ATP Challenger 75',
  'DRAWS, CUTOFFS & SCHEDULE',
  'Size\tDA\tWC\tQ\tSE\tNG\t2025 Cut Offs',
  'QUALIFYING\tSunday 16 August\t-\t24\t20/18\t4\t-\t-\t0/2\t538',
  'MAIN DRAW SINGLES\tMonday 17 August\tSaturday 22 August\t32\t23/18\t3\t6\t0/2\t0/3\t548',
  'MAIN DRAW DOUBLES\tMonday 17 August\tSaturday 22 August\t16\t14\t2\t-\t-\t-\t396',
].join('\n');

const CANCUN = [
  'CANCUN, MEXICO (3009)',
  'ATP Challenger 125',
  'QUALIFYING\tMonday 17 August\t-\t16\t13\t3\t-\t-\t-\tN/A',
  'MAIN DRAW SINGLES\tTuesday 18 August\tSunday 23 August\t28\t21/17\t3\t4\t0/2\t0/3\tN/A',
  'MAIN DRAW DOUBLES\tTuesday 18 August\tSunday 23 August\t16\t14\t2\t-\t-\t-\tN/A',
].join('\n');

describe('parseSheetCell', () => {
  it('takes the leading number where the cell is printed as a pair', () => {
    expect(parseSheetCell('23/18')).toBe(23);
    expect(parseSheetCell('0/2')).toBe(0);
  });

  it('treats a dash and both spellings of unavailable as absent', () => {
    expect(parseSheetCell('-')).toBeNull();
    expect(parseSheetCell('N/A')).toBeNull();
    expect(parseSheetCell('#N/A')).toBeNull();
    expect(parseSheetCell('  ')).toBeNull();
  });

  it('reads a plain count', () => {
    expect(parseSheetCell('32')).toBe(32);
  });
});

describe('parseSheetPair', () => {
  // The held count is what explains a 21-name acceptance list under a stated
  // 23 DA: two of those places are being kept for special exempts.
  it('keeps both halves, so held places are not lost', () => {
    expect(parseSheetPair('0/2')).toEqual({ value: 0, of: 2 });
    expect(parseSheetPair('23/18')).toEqual({ value: 23, of: 18 });
  });

  it('has nothing held where the cell is a single number or a dash', () => {
    expect(parseSheetPair('14')).toEqual({ value: 14, of: null });
    expect(parseSheetPair('-')).toEqual({ value: null, of: null });
  });
});

describe('parseDetailSheetText', () => {
  it('reads the three draws with their sizes and routes', () => {
    const sheet = parseDetailSheetText(PRAGUE);
    expect(sheet.atpCode).toBe('600');
    expect(sheet.level).toBe('ATP Challenger 75');

    const singles = sheet.draws.find((d) => d.draw === 'main_singles');
    expect(singles).toMatchObject({
      size: 32,
      directAcceptances: 23,
      wildCards: 3,
      qualifiers: 6,
      specialExempts: 0,
      specialExemptsHeld: 2,
      nextGen: 0,
      nextGenHeld: 3,
      priorCutoff: 548,
    });

    expect(sheet.draws.find((d) => d.draw === 'qualifying')).toMatchObject({
      size: 24,
      directAcceptances: 20,
      wildCards: 4,
      priorCutoff: 538,
    });

    expect(sheet.draws.find((d) => d.draw === 'main_doubles')).toMatchObject({
      size: 16,
      directAcceptances: 14,
      wildCards: 2,
      priorCutoff: 396,
    });
  });

  // Draw size does not follow from the level, which is the whole reason this
  // sheet has to be read per event rather than assumed.
  it('reads a 28 main draw at one Challenger 125 where a 75 runs 32', () => {
    const cancun = parseDetailSheetText(CANCUN).draws.find((d) => d.draw === 'main_singles');
    const prague = parseDetailSheetText(PRAGUE).draws.find((d) => d.draw === 'main_singles');
    expect(cancun?.size).toBe(28);
    expect(prague?.size).toBe(32);
    expect(parseDetailSheetText(CANCUN).draws.find((d) => d.draw === 'qualifying')?.size).toBe(16);
    expect(parseDetailSheetText(PRAGUE).draws.find((d) => d.draw === 'qualifying')?.size).toBe(24);
  });

  it('keeps the cells verbatim, since the sheet never says what the second number is', () => {
    const singles = parseDetailSheetText(PRAGUE).draws.find((d) => d.draw === 'main_singles');
    expect(singles?.raw).toBe('32 | 23/18 | 3 | 6 | 0/2 | 0/3 | 548');
  });

  it('leaves the prior cut null where the sheet has no figure', () => {
    const singles = parseDetailSheetText(CANCUN).draws.find((d) => d.draw === 'main_singles');
    expect(singles?.priorCutoff).toBeNull();
  });

  it('ignores prose that starts with the same words but states no size', () => {
    const text = 'MAIN DRAW SINGLES will be made on Sunday after 6PM local time at the tournament desk';
    expect(parseDetailSheetText(text).draws).toEqual([]);
  });

  it('returns nothing rather than guessing when the table is absent', () => {
    expect(parseDetailSheetText('CONTACTS\nTOURNAMENT DIRECTOR\tSomeone').draws).toEqual([]);
  });
});

describe('drawAddsUp', () => {
  it('confirms the stated parts account for the stated size', () => {
    for (const draw of parseDetailSheetText(PRAGUE).draws) {
      expect(drawAddsUp(draw)).toBe(true);
    }
    for (const draw of parseDetailSheetText(CANCUN).draws) {
      expect(drawAddsUp(draw)).toBe(true);
    }
  });

  it('fails loudly when the parts do not reach the size', () => {
    const [draw] = parseDetailSheetText(
      'MAIN DRAW SINGLES\tMon\tSat\t32\t20\t3\t6\t-\t-\t-'
    ).draws;
    expect(drawAddsUp(draw)).toBe(false);
  });
});

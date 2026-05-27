import { describe, it, expect } from 'vitest';
import { layoutItemsToText, parseOfficialPdfCutoffText } from './cutoff-pdf-parser';

// pdf.js text item shape: transform[4]=x, transform[5]=y (y grows upward).
function item(str: string, x: number, y: number, width: number) {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe('layoutItemsToText', () => {
  it('keeps a label and the value below it adjacent (draw-sheet bottom box)', () => {
    // Mimics a Challenger draw sheet: a two-column bottom area where the
    // "LAST DIRECT ACCEPTANCE" label (left) shares a row with prize money
    // (right), and the value sits on the row directly below the label.
    const items = [
      // top row (higher y)
      item('LAST DIRECT ACCEPTANCE', 50, 100, 120),
      item('QUARTER-FINALIST', 300, 100, 80),
      item('€ 1,030', 400, 100, 30),
      // value row (lower y, same left column)
      item('Matusevich,', 50, 90, 55),
      item('Anton', 107, 90, 25),
      item('431', 220, 90, 15),
    ];

    const text = layoutItemsToText(items);
    const lines = text.split('\n');

    // The label and the value must end up close together, not scrambled apart.
    const labelIdx = lines.findIndex((l) => /LAST DIRECT ACCEPTANCE/.test(l));
    const valueIdx = lines.findIndex((l) => /Matusevich/.test(l));
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(valueIdx).toBeGreaterThan(labelIdx);
    expect(valueIdx - labelIdx).toBeLessThanOrEqual(4);
  });

  it('lets the parser recover the cut rank from reconstructed layout text', () => {
    const items = [
      item('SEEDED PLAYERS', 50, 120, 80),
      item('LAST DIRECT ACCEPTANCE', 50, 100, 120),
      item('QUARTER-FINALIST', 300, 100, 80),
      item('€ 1,030', 400, 100, 30),
      item('Matusevich,', 50, 90, 55),
      item('Anton', 107, 90, 25),
      item('431', 220, 90, 15),
      item('ALTERNATES/LUCKY LOSERS', 50, 80, 130),
    ];

    const text = layoutItemsToText(items);
    const parsed = parseOfficialPdfCutoffText(text);

    expect(parsed.last_direct_acceptance_rank).toBe(431);
    expect(parsed.last_direct_acceptance_name).toMatch(/Matusevich/);
  });
});

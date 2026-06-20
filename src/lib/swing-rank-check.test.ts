import { describe, expect, it } from 'vitest';
import {
  CutReference,
  describeEntrySummary,
  entryStatus,
  summarizeEntries,
} from './swing-rank-check';

const ref = (o: Partial<CutReference>): CutReference => ({
  mainCut: null,
  mainAlt: null,
  qualCut: null,
  fromYear: 2025,
  ...o,
});

describe('entryStatus', () => {
  it('returns main when rank is within the main-draw cut', () => {
    expect(entryStatus(180, ref({ mainCut: 230, qualCut: 350 }))).toBe('main');
    expect(entryStatus(230, ref({ mainCut: 230 }))).toBe('main'); // boundary inclusive
  });

  it('folds alternates into the main draw, then qualifying, then out', () => {
    // Direct cut 200 but alternates pushed the real cut to 240: 220 made it in.
    const r = ref({ mainCut: 200, mainAlt: 240, qualCut: 320 });
    expect(entryStatus(220, r)).toBe('main');
    expect(entryStatus(240, r)).toBe('main'); // boundary inclusive
    expect(entryStatus(300, r)).toBe('qualifying');
    expect(entryStatus(400, r)).toBe('out');
  });

  it('uses the more generous of direct/alternate as the main-draw cut', () => {
    // Alternate number present but smaller/absent — still take the larger.
    expect(entryStatus(230, ref({ mainCut: 240, mainAlt: 200 }))).toBe('main');
    expect(entryStatus(230, ref({ mainAlt: 240 }))).toBe('main'); // only alt on record
  });

  it('is unknown without a rank or without any cut data', () => {
    expect(entryStatus(null, ref({ mainCut: 200 }))).toBe('unknown');
    expect(entryStatus(200, null)).toBe('unknown');
    expect(entryStatus(200, ref({}))).toBe('unknown');
  });

  it('skips missing cut tiers gracefully', () => {
    // No main cut on record, only qualifying.
    expect(entryStatus(300, ref({ qualCut: 320 }))).toBe('qualifying');
    expect(entryStatus(330, ref({ qualCut: 320 }))).toBe('out');
  });
});

describe('summary', () => {
  it('tallies and describes statuses', () => {
    const s = summarizeEntries(['main', 'main', 'qualifying', 'out', 'unknown']);
    expect(s).toMatchObject({ main: 2, qualifying: 1, out: 1, unknown: 1, total: 5 });
    expect(describeEntrySummary(s)).toBe('2 main draw · 1 qualies · 1 out · 1 no data');
  });
});

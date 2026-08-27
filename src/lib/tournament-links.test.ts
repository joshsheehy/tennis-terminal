import { describe, it, expect } from 'vitest';
import {
  fridayBefore,
  googleFlightsUrl,
  ptlCodeFromUrl,
  resolveTournamentPtlCode,
} from './tournament-links';

describe('fridayBefore', () => {
  it('returns the Friday before a Monday start', () => {
    // 2026-07-13 is a Monday → 2026-07-10 is the Friday before.
    expect(fridayBefore('2026-07-13')).toBe('2026-07-10');
  });

  it('returns the previous Friday when the start is itself a Friday', () => {
    expect(fridayBefore('2026-07-10')).toBe('2026-07-03');
  });

  it('handles a Sunday start', () => {
    // 2026-07-12 is a Sunday → 2026-07-10.
    expect(fridayBefore('2026-07-12')).toBe('2026-07-10');
  });

  it('returns null for missing/invalid dates', () => {
    expect(fridayBefore(null)).toBeNull();
    expect(fridayBefore('not-a-date')).toBeNull();
  });
});

describe('googleFlightsUrl', () => {
  it('pins the one-way date when given', () => {
    const url = googleFlightsUrl('Cary', 'Newport', '2026-07-10');
    expect(decodeURIComponent(url)).toContain(
      'One-way flights to Newport from Cary on 2026-07-10'
    );
  });

  it('omits the date clause when none is given', () => {
    const url = googleFlightsUrl('Cary', 'Newport');
    expect(decodeURIComponent(url)).toContain('One-way flights to Newport from Cary');
    expect(url).not.toContain('%20on%20');
  });
});

describe('resolveTournamentPtlCode', () => {
  // Open de Vendée is absent from the static catalogue, and only its 2022
  // edition was imported from a ProTennisLive URL. Reading one edition at a
  // time left every other year without a detail-sheet link.
  it('finds the code on any edition, not just the one being rendered', () => {
    expect(
      resolveTournamentPtlCode('open-de-vendee', [
        null,
        null,
        'https://www.protennislive.com/posting/2022/6857/mds.pdf',
      ])
    ).toBe('6857');
  });

  it('takes the first code offered, so callers control precedence by order', () => {
    expect(
      resolveTournamentPtlCode('unknown-slug', [
        'https://www.protennislive.com/posting/2026/600/ds.pdf',
        'https://www.protennislive.com/posting/2022/999/mds.pdf',
      ])
    ).toBe('600');
  });

  it('is null when nothing carries a code', () => {
    expect(resolveTournamentPtlCode('unknown-slug', [null, 'https://example.com/x.pdf'])).toBeNull();
    expect(resolveTournamentPtlCode('unknown-slug', [])).toBeNull();
  });
});

describe('ptlCodeFromUrl', () => {
  it('reads the code out of any posting URL, whatever the filename', () => {
    expect(ptlCodeFromUrl('https://www.protennislive.com/posting/2026/3009/ds.pdf')).toBe('3009');
    expect(ptlCodeFromUrl('https://www.protennislive.com/posting/2025/496/qs.pdf')).toBe('496');
  });

  it('ignores anything that is not a posting URL', () => {
    expect(ptlCodeFromUrl('https://www.atptour.com/en/scores/archive/x/2909/2025')).toBeNull();
    expect(ptlCodeFromUrl(null)).toBeNull();
  });
});

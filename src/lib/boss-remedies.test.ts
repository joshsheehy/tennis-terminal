import { describe, expect, it } from 'vitest';
import { remedyFor } from './boss-remedies';

const url = 'https://www.protennislive.com/posting/2026/7009/mds.pdf';
const good = { slug: 'plovdiv-4', year: 2026, event: 'singles', draw: 'main', url, remedy: 'reimport' };

describe('remedyFor', () => {
  it('sends every C1 case to the anomaly cleanup sweep regardless of its data', () => {
    expect(remedyFor({ check_id: 'C1', data: {} })).toEqual({ kind: 'cleanup-anomalies' });
    expect(remedyFor({ check_id: 'C1', data: null })).toEqual({ kind: 'cleanup-anomalies' });
  });

  it('turns well-formed reimport data into a reimport remedy', () => {
    expect(remedyFor({ check_id: 'A2', data: good })).toEqual({
      kind: 'reimport',
      slug: 'plovdiv-4',
      year: 2026,
      event: 'singles',
      draw: 'main',
      url,
    });
    expect(remedyFor({ check_id: 'V1', data: good })).toMatchObject({ kind: 'reimport' });
  });

  it('has no remedy for a check with no reimport data', () => {
    expect(remedyFor({ check_id: 'C3', data: {} })).toEqual({ kind: 'none', reason: 'no automated remedy for C3' });
    expect(remedyFor({ check_id: 'A2', data: { remedy: 'edit-file' } })).toEqual({
      kind: 'none',
      reason: 'no automated remedy for A2',
    });
    expect(remedyFor({ check_id: 'A2', data: undefined })).toMatchObject({ kind: 'none' });
  });

  it.each([
    ['slug', { ...good, slug: '../etc' }],
    ['slug', { ...good, slug: 123 }],
    ['year', { ...good, year: 1999 }],
    ['year', { ...good, year: '2026' }],
    ['event', { ...good, event: 'mixed' }],
    ['draw', { ...good, draw: 'final' }],
    ['url', { ...good, url: 'https://evil.example/mds.pdf' }],
    ['url', { ...good, url: 'not a url' }],
  ])('refuses malformed %s rather than guessing', (_field, data) => {
    expect(remedyFor({ check_id: 'A2', data }).kind).toBe('none');
  });
});

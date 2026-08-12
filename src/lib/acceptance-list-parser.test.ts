import { describe, expect, it } from 'vitest';
import { parseAcceptanceListText,
  splitColumnarRow,
} from './acceptance-list-parser';

describe('parseAcceptanceListText', () => {
  it('parses a Brownsburg-style official ATP acceptance list without treating NG as the cutoff', () => {
    const text = [
      'Official Player Acceptance List',
      'Brownsburg Challenger',
      'Date: 8/10/2026',
      'Ranking Date: 7/20/2026',
      'Original Cut Off: 178',
      '',
      'Direct Acceptances',
      '136 Nicolas Mejia COL DA',
      '174 Patrick Kypson USA DA',
      '178 Gauthier Onclin BEL DA',
      '184 Federico Cina ITA NG',
      '',
      'Alternates',
      '1 181 Murphy Cassone USA ALT',
      '2 188 Tristan Boyer USA ALT',
    ].join('\n');

    const parsed = parseAcceptanceListText(text);

    expect(parsed.parse_status).toBe('parsed');
    expect(parsed.tournament).toBe('Brownsburg Challenger');
    expect(parsed.list_date).toBe('2026-08-10');
    expect(parsed.ranking_date).toBe('2026-07-20');
    expect(parsed.original_cutoff_rank).toBe(178);
    expect(parsed.direct_acceptances).toHaveLength(4);
    expect(parsed.direct_acceptances.at(-1)).toMatchObject({
      name: 'Federico Cina',
      rank: 184,
      status: 'NG',
    });
    expect(parsed.alternates).toHaveLength(2);
    expect(parsed.alternates[0]).toMatchObject({
      position: 1,
      name: 'Murphy Cassone',
      rank: 181,
      status: 'ALT',
    });
  });

  it('preserves protected-ranking entries and the literal official cutoff', () => {
    const text = [
      'OFFICIAL PLAYER ACCEPTANCE LIST',
      'Example Challenger',
      'Date: 04/06/2026',
      'Ranking Date: 03/16/2026',
      'Original Cut Off: 128',
      'Direct Acceptances',
      '87 Player One USA DA',
      '311 Player Protected ESP PR',
      '128 Player Cut FRA DA',
    ].join('\n');

    const parsed = parseAcceptanceListText(text);

    expect(parsed.original_cutoff_rank).toBe(128);
    expect(parsed.direct_acceptances.find((entry) => entry.status === 'PR')).toMatchObject({
      name: 'Player Protected',
      rank: 311,
      status: 'PR',
    });
  });

  it('separates wildcard, qualifier and special-exempt rows by status', () => {
    const text = [
      'Official Player Acceptance List',
      'Status Test Challenger',
      'Original Cut Off: 250',
      'Direct Acceptances',
      '190 Main Player USA DA',
      '300 Wild Player USA WC',
      '400 Qualifier Player AUS Q',
      '210 Exempt Player FRA SE',
    ].join('\n');

    const parsed = parseAcceptanceListText(text);

    expect(parsed.wild_cards.map((entry) => entry.name)).toContain('Wild Player');
    expect(parsed.qualifiers.map((entry) => entry.name)).toContain('Qualifier Player');
    expect(parsed.special_exempts.map((entry) => entry.name)).toContain('Exempt Player');
  });

  it('returns missing_cutoff when an official list has no Original Cut Off field', () => {
    const text = [
      'Official Player Acceptance List',
      'Example Challenger',
      'Ranking Date: 03/16/2026',
      'Direct Acceptances',
      '128 Player One USA DA',
    ].join('\n');

    const parsed = parseAcceptanceListText(text);
    expect(parsed.parse_status).toBe('missing_cutoff');
    expect(parsed.original_cutoff_rank).toBeNull();
    expect(parsed.direct_acceptances).toHaveLength(1);
  });

  it('rejects unrelated PDFs rather than treating rankings as an entry list', () => {
    const text = [
      'ATP Challenger Main Draw',
      'LAST DIRECT ACCEPTANCE',
      'Player Example - 311',
      'ATP SUPERVISOR',
    ].join('\n');

    const parsed = parseAcceptanceListText(text);
    expect(parsed.parse_status).toBe('not_acceptance_list');
    expect(parsed.original_cutoff_rank).toBeNull();
  });
});

describe('splitColumnarRow', () => {
  // These PDFs print the list in two columns; extraction flattens a row into
  // one line holding both players. Reading it as a single record silently
  // discarded the right-hand column — half of every list.
  it('splits a two-player row into one record each', () => {
    expect(
      splitColumnarRow('Michalski, Daniel\tPOL\t304\tCaniato, Carlo Alberto\tITA\t391')
    ).toEqual(['Michalski, Daniel\tPOL\t304', 'Caniato, Carlo Alberto\tITA\t391']);
  });

  it('does not eat the first letter of the next name as a status code', () => {
    // Without a field-boundary lookahead the "C" of Caniato was captured as a
    // status and stripped, leaving "aniato, Carlo Alberto".
    const out = splitColumnarRow('A, B\tPOL\t304\tCaniato, Carlo Alberto\tITA\t391');
    expect(out[1]).toBe('Caniato, Carlo Alberto\tITA\t391');
  });

  it('keeps a genuine status code', () => {
    expect(splitColumnarRow('X, Y\tESP\t107\tPR\tZ, W\tFRA\t200')).toEqual([
      'X, Y\tESP\t107\tPR',
      'Z, W\tFRA\t200',
    ]);
  });

  it('keeps entry-count markers in the name', () => {
    expect(splitColumnarRow('Weis, Alexander (1)\tITA\t587\tFilar, Karol (2)\tPOL\t597')).toEqual([
      'Weis, Alexander (1)\tITA\t587',
      'Filar, Karol (2)\tPOL\t597',
    ]);
  });

  it('leaves a single-column row untouched', () => {
    expect(splitColumnarRow('Solo, Player\tITA\t100')).toEqual(['Solo, Player\tITA\t100']);
    expect(splitColumnarRow('Alternates')).toEqual(['Alternates']);
  });

  it('never splits the metadata header, whose numbers look like rankings', () => {
    const header = 'Date:\t8/10/2026\tOriginal Cut Off:\t585\tRankings Date:\t7/22/2026';
    expect(splitColumnarRow(header)).toEqual([header]);
  });
});

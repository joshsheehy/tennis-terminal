import { describe, expect, it } from 'vitest';
import { computeAfterAlts, findRank, indexRanking, pickSnapshot, rankingDateFor, type RankedPlayer } from './after-alts';
import { assembleAlternates, type DrawAlternates, type PositionedText } from './draw-alternates';
import { parseRankingPages } from './ranking-pdf';

const LIST: RankedPlayer[] = [
  [5, 'Medvedev', 'Daniil', ''],
  [311, 'Shelbayh', 'Abdullah', 'JOR'],
  [495, 'Tarvet', 'Oliver', 'GBR'],
  [263, 'Martin', 'Andres', 'USA'],
  [900, 'Martin', 'Andrej', 'SVK'],
  [400, 'Zheng', 'Michael', 'USA'],
];
const index = indexRanking(LIST);

const singles = (...players: Array<[string, string, string | null]>): DrawAlternates => ({
  event: 'singles',
  count: players.length,
  slots: players.map(([surname, first, nat]) => [{ surname, first, nat }]),
  complete: true,
});

describe('findRank', () => {
  it('matches a sheet name, case and order aside', () => {
    expect(findRank(index, { surname: 'SHELBAYH', first: 'Abdullah', nat: 'JOR' })).toBe(311);
  });
  it('separates namesakes by country, and calls it ambiguous without one', () => {
    expect(findRank(index, { surname: 'MARTIN', first: 'A.', nat: 'USA' })).toBe(263);
    expect(findRank(index, { surname: 'MARTIN', first: 'A.', nat: null })).toBe('ambiguous');
  });
  it('lets a blank ranking country match', () => {
    expect(findRank(index, { surname: 'MEDVEDEV', first: 'Daniil', nat: 'RUS' })).toBe(5);
  });
});

describe('computeAfterAlts', () => {
  it('takes the lowest-ranked alternate as the cut after alts', () => {
    const result = computeAfterAlts(singles(['SHELBAYH', 'Abdullah', 'JOR'], ['TARVET', 'Oliver', 'GBR']), index, null);
    expect(result).toEqual({ complete: true, best: 311, lowest: 495, unranked: false });
  });
  it('marks an alternate with no ranking as unranked', () => {
    const result = computeAfterAlts(singles(['TARVET', 'Oliver', 'GBR'], ['COZBINOV', 'Alexandr', 'MDA']), index, null);
    expect(result).toEqual({ complete: true, best: 495, lowest: 495, unranked: true });
  });
  it('does not call a look-alike spelling unranked', () => {
    const result = computeAfterAlts(singles(['ZHENG SMITH', 'Michael', 'CAN']), index, null);
    expect(result.complete).toBe(false);
  });
  it('waits for a doubles list rather than guessing a team', () => {
    const doubles: DrawAlternates = { event: 'doubles', count: 1, complete: true, slots: [[{ surname: 'TARVET', first: 'Oliver', nat: 'GBR' }, { surname: 'ZHENG', first: 'Michael', nat: 'USA' }]] };
    expect(computeAfterAlts(doubles, index, null).complete).toBe(false);
    const withList = computeAfterAlts(doubles, index, indexRanking([[100, 'Tarvet', 'Oliver', 'GBR']]));
    expect(withList).toEqual({ complete: true, best: 500, lowest: 500, unranked: false });
  });
});

describe('ranking dates', () => {
  it('is the Monday before the tournament week, rolling weekend starts forward', () => {
    expect(rankingDateFor('2026-11-09')).toBe('2026-11-02'); // Monday
    expect(rankingDateFor('2026-11-08')).toBe('2026-11-02'); // Sunday start
    expect(rankingDateFor('2026-06-13')).toBe('2026-06-08'); // Saturday start
    expect(rankingDateFor('2026-03-04')).toBe('2026-02-23'); // Wednesday start
  });
  it('uses an older list only when it was still published after the target day', () => {
    const older = { listDate: '2026-03-02', lastSeen: '2026-03-12T10:00:00Z' };
    expect(pickSnapshot([older], '2026-03-02')).toBe(older);
    expect(pickSnapshot([older], '2026-03-09')).toBe(older); // second week of Indian Wells
    expect(pickSnapshot([{ listDate: '2026-03-02', lastSeen: '2026-03-08T10:00:00Z' }], '2026-03-09')).toBeNull();
    expect(pickSnapshot([older], '2026-02-23')).toBeNull();
    // the December freeze: the same list is still being seen weeks later
    const frozen = { listDate: '2026-11-30', lastSeen: '2026-12-29T10:00:00Z' };
    expect(pickSnapshot([frozen], '2026-12-28')).toBe(frozen);
  });
});

describe('bracket reader', () => {
  const row = (y: number, ...cells: Array<[number, string]>): PositionedText[] => cells.map(([x, str]) => ({ x, y, str }));
  it('reads a singles Alt slot with its country', () => {
    const page = [
      ...row(771, [503, 'Main Draw Singles']),
      ...row(732, [19, '2'], [52, 'KASNIKOWSKI, Maks'], [127, 'POL']),
      ...row(718, [19, '3'], [32, 'Alt'], [52, 'SHELBAYH, Abdullah'], [127, 'JOR']),
      ...row(704, [19, '4'], [52, 'VAN ASSCHE, Luca'], [127, 'FRA']),
      ...row(258, [14, 'Last Direct Acceptance']),
      ...row(233, [262, 'O. Tarvet (Alt)']),
    ];
    expect(assembleAlternates([page])).toEqual({ event: 'singles', count: 1, complete: true, slots: [[{ surname: 'SHELBAYH', first: 'Abdullah', nat: 'JOR' }]] });
  });
  it('reads both partners of an Alt team from the rows around its status', () => {
    const page = [
      ...row(771, [503, 'Main Draw Doubles']),
      ...row(696, [66, 'AUS'], [87, 'PUTTERGILL, Calum']),
      ...row(681, [44, '2'], [51, 'Alt']),
      ...row(673, [66, 'AUS'], [87, 'SWEENY, Dane']),
      ...row(649, [66, 'NMI'], [87, 'SINCLAIR, Colin']),
      ...row(626, [66, 'SRB'], [87, 'ZEKIC, Miljan']),
      ...row(108, [228, 'LAST DIRECT ACCEPTANCE:']),
    ];
    const read = assembleAlternates([page]);
    expect(read.count).toBe(1);
    expect(read.slots[0].map((p) => p.surname)).toEqual(['PUTTERGILL', 'SWEENY']);
  });
});

describe('ranking list PDF', () => {
  it('reads the date, ties and a blank country', () => {
    const text = (y: number, str: string): PositionedText => ({ x: 10, y, str });
    const parsed = parseRankingPages([
      [
        text(800, 'Rankings Date: Nov 23, 2026 Total'),
        text(700, '5 Medvedev, Daniil 4220 510 1680 2030 25 0 0'),
        text(690, '2312 T Holder, Carl (GBR) 1 0 0 1 9 0 0'),
      ],
    ]);
    expect(parsed).toEqual({ listDate: '2026-11-23', players: [[5, 'Medvedev', 'Daniil', ''], [2312, 'Holder', 'Carl', 'GBR']] });
  });
});

import { describe, it, expect } from 'vitest';
import {
  standingFor,
  outcomeScore,
  describeStanding,
  standingsForEvents,
  type ListEntrant,
} from './entry-position';

const e = (rank: number | null, name = `p${rank}`): ListEntrant => ({ name, rank });

// A four-place draw with three waiting, so the boundary is easy to reason about.
const accepted = [e(100), e(150), e(200), e(250)];
const waiting = [e(300), e(350), e(400)];

describe('standingFor', () => {
  it('puts a better ranking straight into the draw', () => {
    const s = standingFor(120, accepted, waiting, 'main');
    expect(s.ahead).toBe(1); // only #100
    expect(s.position).toBe(2);
    expect(s.alternateNumber).toBeNull();
  });

  it('numbers the alternate queue from the first place outside the draw', () => {
    // 4 in the draw; #260 has 4 ahead, so position 5 = first alternate.
    expect(standingFor(260, accepted, waiting, 'main').alternateNumber).toBe(1);
    expect(standingFor(310, accepted, waiting, 'main').alternateNumber).toBe(2);
  });

  it('counts the last place inside the draw as in, not as alternate zero', () => {
    const s = standingFor(240, accepted, waiting, 'main');
    expect(s.position).toBe(4);
    expect(s.alternateNumber).toBeNull();
  });

  it('places an equal ranking behind the incumbent, who is not displaced', () => {
    const s = standingFor(200, accepted, waiting, 'main');
    expect(s.ahead).toBe(3); // 100, 150 and the incumbent 200
    expect(s.position).toBe(4);
  });

  it('treats unranked entrants as behind every ranked player', () => {
    const withUnranked = [e(100), e(null, 'wildcard'), e(200)];
    const s = standingFor(150, withUnranked, [], 'main');
    expect(s.ahead).toBe(1);
    expect(s.position).toBe(2);
  });

  it('handles a ranking worse than the whole field', () => {
    const s = standingFor(9999, accepted, waiting, 'main');
    expect(s.ahead).toBe(7);
    expect(s.alternateNumber).toBe(4);
  });

  it('handles an empty list', () => {
    const s = standingFor(300, [], [], 'qualifying');
    expect(s.position).toBe(1);
    expect(s.drawSize).toBe(0);
    expect(s.alternateNumber).toBe(1);
  });
});

describe('outcomeScore', () => {
  const inMain = standingFor(50, accepted, waiting, 'main');
  const altMain = standingFor(9999, accepted, waiting, 'main');
  const inQual = standingFor(50, accepted, waiting, 'qualifying');
  const altQual = standingFor(9999, accepted, waiting, 'qualifying');

  it('ranks a main-draw place above everything', () => {
    expect(outcomeScore(inMain, altQual)).toBe(0);
    expect(outcomeScore(inMain, inQual)).toBe(0);
  });

  it('prefers a qualifying place to being an alternate', () => {
    // A guaranteed match beats a wait, even a short one.
    expect(outcomeScore(altMain, inQual)).toBeLessThan(outcomeScore(altMain, altQual));
  });

  it('orders alternates by how short the queue is', () => {
    const near = standingFor(260, accepted, waiting, 'main');
    const far = standingFor(9999, accepted, waiting, 'main');
    expect(outcomeScore(near, altQual)).toBeLessThan(outcomeScore(far, altQual));
  });
});

describe('describeStanding', () => {
  it('says plainly whether the player is in or waiting', () => {
    expect(describeStanding(standingFor(50, accepted, waiting, 'main'))).toBe(
      'In the main draw'
    );
    expect(describeStanding(standingFor(9999, accepted, waiting, 'qualifying'))).toBe(
      'qualifying alternate 4'
    );
  });
});

describe('standingsForEvents', () => {
  const events = [
    {
      slug: 'strong',
      name: 'Strong',
      level: 'CH 125',
      surface: 'Hard',
      main: [e(50), e(60), e(70), e(80)],
      mainNext: [e(90)],
      qualifying: [e(100), e(110)],
      qualifyingNext: [e(120)],
    },
    {
      slug: 'weak',
      name: 'Weak',
      level: 'CH 50',
      surface: 'Clay',
      main: [e(400), e(410), e(420), e(430)],
      mainNext: [e(440)],
      qualifying: [e(500), e(510)],
      qualifyingNext: [e(520)],
    },
  ];

  it('puts the event the player actually gets into first', () => {
    // #300 walks into the weak event and is nowhere near the strong one.
    const out = standingsForEvents(300, events);
    expect(out[0].slug).toBe('weak');
    expect(out[0].main.alternateNumber).toBeNull();
  });

  it('flips the order for a much better ranking', () => {
    const out = standingsForEvents(55, events);
    expect(out.map((o) => o.slug).sort()).toEqual(['strong', 'weak']);
    expect(out.every((o) => o.main.alternateNumber == null)).toBe(true);
  });

  it('reports both draws for every event, not just the better one', () => {
    const out = standingsForEvents(300, events);
    for (const o of out) {
      expect(o.main).toBeDefined();
      expect(o.qualifying).toBeDefined();
    }
  });

  it('is stable for events with identical outcomes', () => {
    const out = standingsForEvents(9999, events);
    expect(out).toHaveLength(2);
  });
});

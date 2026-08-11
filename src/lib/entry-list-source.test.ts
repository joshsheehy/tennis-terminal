import { describe, it, expect } from 'vitest';
import {
  parseEntryListPage,
  parseLevelFromName,
  parseSurfaceFromName,
  parsePlaceFromName,
  impliedCut,
  levelFromBucket,
} from './entry-list-source';

// Shaped exactly like the real page: one scratch variable reassigned per week,
// each preceded by a "// WEEK n - Mon DD" comment and followed by a render call.
const PAGE = `
<script>
  atpData = { week1: {} };
  // WEEK 13 - Aug 17
  atpData.week1 = { "gs":[], "atp1000":[], "atp125":[
    { name: "Cancun (CH 125) - Hardcourt",
      main: [[23,"Luciano Darderi","ITA"],[50,"Juan Cerúndolo","ARG"],[221,"Darwin Blanch","USA"]],
      wc: [],
      qual: [[131,"Nicolás Mejía","COL"]],
      qnext: [[123,"Henrique Rocha","POR"]] },
    { name: "Kingston (CH 75) - Hardcourt",
      main: [[78,"Valentin Royer","FRA"],[225,"Franco Roncadelli","URU"],["","Guto Miguel","BRA"]],
      wc: [], qual: [], qnext: [] }
  ], "itf":[
    { name: "M25 Lesa - Claycourt", main: [[400,"Someone","ITA"]], wc: [], qual: [], qnext: [] }
  ] };
  renderWeek(atpData.week1, 17);

  // WEEK 14 - Aug 24
  atpData.week1 = { "gs":[
    { name: "US Open Qualifying - Hardcourt", main: [], wc: [],
      qual: [[107,"Carlos Taberner","ESP","PR"],[110,"Jacob Fearnley","GBR"]], qnext: [] }
  ], "atp250":[
    { name: "Winston-Salem (ATP 250) - Hardcourt",
      main: [[40,"A Player","USA"]], wc: [[900,"Wildcard Kid","USA","WC"]], qual: [], qnext: [] }
  ] };
  renderWeek(atpData.week1, 18);
</script>`;

describe('name parsing', () => {
  it('reads the level from the label, not the tier bucket', () => {
    // The source files every Challenger from CH 50 to CH 125 under one
    // "atp125" key, so the bucket cannot be trusted for level.
    expect(parseLevelFromName('Cancun (CH 125) - Hardcourt')).toBe('Challenger 125');
    expect(parseLevelFromName('Kingston (CH 75) - Hardcourt')).toBe('Challenger 75');
    expect(parseLevelFromName('Roehampton (CH 50) - Hardcourt')).toBe('Challenger 50');
  });

  it('reads ATP, ITF and slam levels', () => {
    expect(parseLevelFromName('Winston-Salem (ATP 250) - Hardcourt')).toBe('ATP 250');
    expect(parseLevelFromName('M25 Lesa - Claycourt')).toBe('ITF M25');
    expect(parseLevelFromName('US Open - Hardcourt')).toBe('Grand Slam');
    expect(parseLevelFromName('US Open Qualifying - Hardcourt')).toBe('Grand Slam Qualifying');
  });

  it('returns null for a label it cannot place', () => {
    expect(parseLevelFromName('Some Exhibition')).toBeNull();
  });

  it('normalises the surface', () => {
    expect(parseSurfaceFromName('Cancun (CH 125) - Hardcourt')).toBe('Hard');
    expect(parseSurfaceFromName('Prague (CH 75) - Claycourt')).toBe('Clay');
    expect(parseSurfaceFromName('Nowhere')).toBeNull();
  });

  it('strips decoration to leave the place', () => {
    expect(parsePlaceFromName('Cancun (CH 125) - Hardcourt')).toBe('Cancun');
    expect(parsePlaceFromName('M25 Lesa - Claycourt')).toBe('Lesa');
    expect(parsePlaceFromName('Winston-Salem (ATP 250) - Hardcourt')).toBe('Winston-Salem');
  });
});

describe('parseEntryListPage', () => {
  const weeks = parseEntryListPage(PAGE);

  it('separates weeks by the comment marker, not the variable name', () => {
    // Every week assigns the same scratch variable, so keying off it would
    // collapse the whole page into one week.
    expect(weeks).toHaveLength(2);
    expect(weeks[0].sourceWeek).toBe(13);
    expect(weeks[0].dateLabel).toBe('Aug 17');
    expect(weeks[1].sourceWeek).toBe(14);
  });

  it('finds every tournament in a week across tier buckets', () => {
    expect(weeks[0].tournaments.map((t) => t.name)).toEqual(['Cancun', 'Kingston', 'Lesa']);
  });

  it('does not leak players from one tournament into the next', () => {
    const kingston = weeks[0].tournaments.find((t) => t.name === 'Kingston')!;
    expect(kingston.main.map((p) => p.name)).toEqual([
      'Valentin Royer',
      'Franco Roncadelli',
      'Guto Miguel',
    ]);
    expect(kingston.qualifying).toEqual([]);
  });

  it('keeps unranked players but gives them a null rank', () => {
    const kingston = weeks[0].tournaments.find((t) => t.name === 'Kingston')!;
    const unranked = kingston.main.find((p) => p.name === 'Guto Miguel')!;
    expect(unranked.rank).toBeNull();
    expect(unranked.country).toBe('BRA');
  });

  it('captures the qualifying queue separately from the main draw', () => {
    const cancun = weeks[0].tournaments.find((t) => t.name === 'Cancun')!;
    expect(cancun.main).toHaveLength(3);
    expect(cancun.qualifying.map((p) => p.rank)).toEqual([131]);
    expect(cancun.qualifyingNext.map((p) => p.rank)).toEqual([123]);
  });

  it('reads trailing status markers as flags', () => {
    const usoq = weeks[1].tournaments.find((t) => t.rawName.includes('US Open Qualifying'))!;
    expect(usoq.qualifying[0].flags).toEqual(['PR']);
    expect(usoq.qualifying[1].flags).toEqual([]);
  });

  it('returns nothing for a page with no week markers', () => {
    expect(parseEntryListPage('<html>no data</html>')).toEqual([]);
  });
});

describe('impliedCut', () => {
  const weeks = parseEntryListPage(PAGE);

  it('is the worst-ranked direct acceptance', () => {
    const cancun = weeks[0].tournaments.find((t) => t.name === 'Cancun')!;
    expect(impliedCut(cancun.main)).toBe(221);
  });

  it('ignores unranked players, which cannot be the boundary', () => {
    const kingston = weeks[0].tournaments.find((t) => t.name === 'Kingston')!;
    expect(impliedCut(kingston.main)).toBe(225);
  });

  it('ignores wildcards, which do not set a cut', () => {
    const ws = weeks[1].tournaments.find((t) => t.name === 'Winston-Salem')!;
    expect(impliedCut(ws.wildCards)).toBeNull();
    expect(impliedCut(ws.main)).toBe(40);
  });

  it('is null when nothing is ranked', () => {
    expect(impliedCut([])).toBeNull();
  });
});

// The claim that a Slam qualifying week strips the 100-240 band out of
// Challengers is checkable directly from these lists, which is the point of
// having them.
describe('Slam qualifying overlap is observable', () => {
  const weeks = parseEntryListPage(PAGE);
  it('exposes the ranks committed to Slam qualifying that week', () => {
    const usoq = weeks[1].tournaments.find((t) => t.rawName.includes('US Open Qualifying'))!;
    const ranks = usoq.qualifying.map((p) => p.rank).filter((r): r is number => r != null);
    expect(ranks.every((r) => r >= 100 && r <= 240)).toBe(true);
  });
});

describe('level fallback via tier bucket', () => {
  const weeks = parseEntryListPage(PAGE);

  it('resolves an ATP tour event whose label carries no level marker', () => {
    // "Winston-Salem - Hardcourt" has no "(ATP 250)" in the name; only the
    // bucket it sits in identifies it.
    const ws = weeks[1].tournaments.find((t) => t.name === 'Winston-Salem')!;
    expect(ws.bucket).toBe('atp250');
    expect(ws.level).toBe('ATP 250');
  });

  it('never lets the Challenger bucket override a label', () => {
    // Kingston is a CH 75 filed under the "atp125" bucket. Trusting the bucket
    // would promote every Challenger to 125.
    const kingston = weeks[0].tournaments.find((t) => t.name === 'Kingston')!;
    expect(kingston.bucket).toBe('atp125');
    expect(kingston.level).toBe('Challenger 75');
  });

  it('maps the tour buckets it can trust', () => {
    expect(levelFromBucket('gs')).toBe('Grand Slam');
    expect(levelFromBucket('atp1000')).toBe('ATP 1000');
    expect(levelFromBucket('atp125')).toBeNull();
    expect(levelFromBucket(null)).toBeNull();
  });
});

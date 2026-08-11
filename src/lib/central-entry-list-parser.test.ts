import { describe, expect, it } from 'vitest';
import { parseCentralAtpEntryPage, selectCentralWeekForCities } from './central-entry-list-parser';

const html = `
<div>Data updated Aug 10, 2026 at 11:00 AM ESTticktocktennis.com</div>
<script>
atpData.week1 = { "atp125":[{ name: "Astana (CH 50) - Hardcourt", main: [[281,"Player Old","RUS"]], wc: [], qual: [], qnext: [] }] };
renderWeek(atpData.week1, 12);
atpData.week1 = { "atp125":[
  { name: "Quebec City (CH 125) - Hardcourt", main: [[32,"Alexander Blockx","BEL"],[36,"Zizou Bergs","BEL"]], wc: [], qual: [[109,"Eliot Spizzirri","USA"]], qnext: [[106,"Jesper de Jong","NED"]] },
  { name: "Cancun (CH 125) - Hardcourt", main: [[23,"Luciano Darderi","ITA"]], wc: [], qual: [[131,"Nicolás Mejía","COL"]], qnext: [] },
  { name: "Kingston (CH 75) - Hardcourt", main: [[78,"Valentin Royer","FRA"],["","Guto Miguel","BRA"]], wc: [], qual: [[228,"Oliver Crawford","GBR"]], qnext: [[255,"Harold Mayot","FRA"]] },
  { name: "Prague (CH 75) - Claycourt", main: [[154,"Zdeněk Kolář","CZE"]], wc: [], qual: [], qnext: [] },
  { name: "Roehampton (CH 50) - Hardcourt", main: [[190,"Elmer Møller","DEN"]], wc: [], qual: [], qnext: [] },
  { name: "Sion (CH 50) - Claycourt", main: [[201,"Lorenzo Giustino","ITA"]], wc: [], qual: [], qnext: [] }
] };
renderWeek(atpData.week1, 13);
</script>`;

describe('central ATP entry-list parser', () => {
  it('parses repeated embedded week assignments without executing remote JS', () => {
    const parsed = parseCentralAtpEntryPage(html);
    expect(parsed.weeks).toHaveLength(2);
    expect(parsed.weeks[1].renderIndex).toBe(13);
    expect(parsed.weeks[1].tournaments).toHaveLength(6);
    expect(parsed.weeks[1].tournaments[0].qualifyingNextIn[0].name).toBe('Jesper de Jong');
    expect(parsed.weeks[1].tournaments[2].main[1].rank).toBeNull();
  });

  it('selects the block containing the requested ATP week cities', () => {
    const selected = selectCentralWeekForCities(parseCentralAtpEntryPage(html), [
      'Quebec City', 'Cancun', 'Kingston', 'Prague', 'Roehampton', 'Sion',
    ]);
    expect(selected.week?.renderIndex).toBe(13);
    expect(selected.matchedCities).toHaveLength(6);
  });
});

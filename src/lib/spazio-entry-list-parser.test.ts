import { describe, expect, it } from 'vitest';
import { parseSpazioChallengerWeekHtml } from './spazio-entry-list-parser';

describe('parseSpazioChallengerWeekHtml', () => {
  it('preserves original row order and explicit OUT/IN/strike markers', () => {
    const html = `
      <h3>ENTRY LIST ATP CHALLENGER 75 KINGSTON</h3>
      <p>
        <span>Royer, Valentin FRA 78</span><br />
        <del><span>Broady, Liam GBR 202</span></del><br />
        <span>Ymer, Elias SWE 203</span>
      </p>
      <p><strong>ALTERNATES</strong><br />
        <span style="color:green">IN Crawford, Oliver GBR 228</span><br />
        <span>Ferreira Silva, Frederico POR 235</span><br />
        <del><span>Broom, Charles GBR 283</span></del>
      </p>`;

    const [event] = parseSpazioChallengerWeekHtml(html);
    expect(event.slug).toBe('kingston');
    expect(event.main.map((row) => row.name)).toEqual([
      'Royer, Valentin',
      'Broady, Liam',
      'Ymer, Elias',
    ]);
    expect(event.main[1].marker).toBe('struck');
    expect(event.alternates[0]).toMatchObject({
      name: 'Crawford, Oliver',
      entryRank: 228,
      marker: 'in',
    });
    expect(event.alternates[2].marker).toBe('struck');
  });

  it('recognizes explicit OUT as stronger than generic strikethrough', () => {
    const html = `
      <h3>ENTRY LIST ATP CHALLENGER 125 CANCUN</h3>
      <p><del><strong>OUT Darderi, Luciano ITA 23</strong></del><br />Cerundolo, Juan Manuel ARG 50</p>
      <p><strong>ALTERNATES</strong><br />IN Rocha, Henrique POR 123</p>`;
    const [event] = parseSpazioChallengerWeekHtml(html);
    expect(event.main[0].marker).toBe('out');
    expect(event.alternates[0].marker).toBe('in');
  });
});

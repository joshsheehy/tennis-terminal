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

  // The live page writes `<br data-start="1751" data-end="1754">`. The earlier
  // `<br\s*\/?>` pattern only matched the bare tag, so every player in a
  // paragraph ran together and the draw came back as a single row whose name
  // was the whole list.
  it('splits on br tags that carry attributes', () => {
    const html = `
      <h3>ENTRY LIST ATP CHALLENGER 75 KINGSTON</h3>
      <p><span>Royer, Valentin FRA 78</span><br data-start="1751" data-end="1754"><span>Heide, Gustavo BRA 134</span><br data-start="1776" data-end="1779"><span>Martínez, Pedro ESP 148</span></p>`;
    const [event] = parseSpazioChallengerWeekHtml(html);
    expect(event.main.map((row) => row.name)).toEqual([
      'Royer, Valentin',
      'Heide, Gustavo',
      'Martínez, Pedro',
    ]);
  });

  it('refuses a run-together line rather than reading it as one player', () => {
    const html = `
      <h3>ENTRY LIST ATP CHALLENGER 75 KINGSTON</h3>
      <p>Royer, Valentin FRA 78 Heide, Gustavo BRA 134 Martínez, Pedro ESP 148 Bueno, Gonzalo PER 160</p>`;
    const [event] = parseSpazioChallengerWeekHtml(html) ?? [];
    expect(event).toBeUndefined();
  });

  it('keeps the entry code, which marks a rank that is not an ATP ranking', () => {
    const html = `
      <h3>ENTRY LIST ATP CHALLENGER 75 KINGSTON</h3>
      <p>Miguel, Guto BRA 11 (JR)<br data-start="1" data-end="2">Royer, Valentin FRA 78</p>`;
    const [event] = parseSpazioChallengerWeekHtml(html);
    expect(event.main[0].entryCode).toBe('JR');
    expect(event.main[1].entryCode).toBeNull();
  });
});

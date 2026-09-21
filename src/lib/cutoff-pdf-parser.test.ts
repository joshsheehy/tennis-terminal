import { describe, it, expect } from 'vitest';
import { layoutItemsToText, parseOfficialPdfCutoffText } from './cutoff-pdf-parser';


// pdf.js text item shape: transform[4]=x, transform[5]=y (y grows upward).
function item(str: string, x: number, y: number, width: number) {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe('layoutItemsToText', () => {
  it('keeps a label and the value below it adjacent (draw-sheet bottom box)', () => {
    // Mimics a Challenger draw sheet: a two-column bottom area where the
    // "LAST DIRECT ACCEPTANCE" label (left) shares a row with prize money
    // (right), and the value sits on the row directly below the label.
    const items = [
      // top row (higher y)
      item('LAST DIRECT ACCEPTANCE', 50, 100, 120),
      item('QUARTER-FINALIST', 300, 100, 80),
      item('€ 1,030', 400, 100, 30),
      // value row (lower y, same left column)
      item('Matusevich,', 50, 90, 55),
      item('Anton', 107, 90, 25),
      item('431', 220, 90, 15),
    ];

    const text = layoutItemsToText(items);
    const lines = text.split('\n');

    // The label and the value must end up close together, not scrambled apart.
    const labelIdx = lines.findIndex((l) => /LAST DIRECT ACCEPTANCE/.test(l));
    const valueIdx = lines.findIndex((l) => /Matusevich/.test(l));
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(valueIdx).toBeGreaterThan(labelIdx);
    expect(valueIdx - labelIdx).toBeLessThanOrEqual(4);
  });

  it('lets the parser recover the cut rank from reconstructed layout text', () => {
    const items = [
      item('SEEDED PLAYERS', 50, 120, 80),
      item('LAST DIRECT ACCEPTANCE', 50, 100, 120),
      item('QUARTER-FINALIST', 300, 100, 80),
      item('€ 1,030', 400, 100, 30),
      item('Matusevich,', 50, 90, 55),
      item('Anton', 107, 90, 25),
      item('431', 220, 90, 15),
      item('ALTERNATES/LUCKY LOSERS', 50, 80, 130),
    ];

    const text = layoutItemsToText(items);
    const parsed = parseOfficialPdfCutoffText(text);

    expect(parsed.last_direct_acceptance_rank).toBe(431);
    expect(parsed.last_direct_acceptance_name).toMatch(/Matusevich/);
  });
});

describe('byes and alternates in the Last Direct Acceptance box', () => {
  // Text taken from the real Brazzaville 2026 draw sheets (protennislive posting 2961).
  it('reports "Byes (10)" as open slots, not as a cut of 10 (qualifying sheet)', () => {
    const text = ['Qualifying Round 1', 'Last Direct Acceptance', 'Byes (10)', 'ATP Supervisor', 'Paulo Cardoso'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
    expect(parsed.last_direct_acceptance_name).toBeNull();
    expect(parsed.byes_count).toBe(10);
  });

  it('keeps the real doubles advance cut and reads the on-site byes separately', () => {
    const text = ['Last Direct Acceptance', 'Adv. 2949 / On-site Byes (2)', 'ATP Supervisor'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
    expect(parsed.challenger_doubles_advanced_cut_rank).toBe(2949);
    expect(parsed.challenger_doubles_onsite_cut_rank).toBeNull();
    expect(parsed.byes_count).toBe(2);
  });

  it('does not turn "On-site Byes (3)" into a cut of 3 (the Temuco doubles bug)', () => {
    const text = ['Last Direct Acceptance', 'Adv. 1184 / On-site Byes (3)', 'ATP Supervisor'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
    expect(parsed.byes_count).toBe(3);
  });

  it('handles the label and Byes on one line, and a single bye', () => {
    const parsed = parseOfficialPdfCutoffText('LAST DIRECT ACCEPTANCE Byes (1) ATP SUPERVISOR');
    expect(parsed.last_direct_acceptance_rank).toBeNull();
    expect(parsed.byes_count).toBe(1);
  });

  it('does not treat "Alt. (3)" as a player with rank 3 (the Brazzaville main-draw bug)', () => {
    const text = ['Last Direct Acceptance', 'Alt. (3)', 'ATP Supervisor'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
    expect(parsed.byes_count).toBeNull();
  });

  it('ignores per-slot "Bye" rows in the bracket, which have no count', () => {
    const text = ['2Bye', '3WCBOLANGI, BienvenueCOD', '6Bye', 'Last Direct Acceptance', 'Matusevich, Anton - 431', 'ATP Supervisor'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.byes_count).toBeNull();
    expect(parsed.last_direct_acceptance_rank).toBe(431);
  });

  it('still parses an ordinary cut and reports no byes', () => {
    const parsed = parseOfficialPdfCutoffText(['Last Direct Acceptance', 'Matusevich, Anton - 431', 'ATP Supervisor'].join('\n'));
    expect(parsed.last_direct_acceptance_rank).toBe(431);
    expect(parsed.byes_count).toBeNull();
  });
});

describe('older sheet layouts and lines that are not a cut', () => {
  // Lines below are copied from real 2022-23 draw sheets, taken from the web archive.
  it('reads the value printed just before the label (Rome 2022)', () => {
    const parsed = parseOfficialPdfCutoffText(
      ['CARRENO BUSTA, Pablo', 'G. Armstrong/C. Sanches/R. Herfel/C. Di DioATP SUPERVISORSGoffin, David - 47LAST DIRECT ACCEPTANCE:', 'THIRD ROUND€ 72,865', 'SECOND ROUND', '8'].join('\n')
    );
    expect(parsed.last_direct_acceptance_rank).toBe(47);
    expect(parsed.last_direct_acceptance_name).toBe('Goffin, David');
  });

  it('reads a value with no dash before the label (Monte-Carlo 2022)', () => {
    const parsed = parseOfficialPdfCutoffText(
      ['BASILASHVILI, Nikoloz', 'G.Armstrong/C. Sanches/C.MourierATP SUPERVISORSRinderknech, A  57LAST DIRECT ACCEPTANCE:', 'THIRD ROUND€ 72,865', 'SECOND ROUND', 'R. Bautista Agut (Right wrist)', '8'].join('\n')
    );
    expect(parsed.last_direct_acceptance_rank).toBe(57);
  });

  it('reads the Cincinnati 2022 line with the supervisors first', () => {
    const parsed = parseOfficialPdfCutoffText(
      ['8', '101619', 'Ali Nili, Roland HerfelATP SUPERVISORSBrandon Nakashima - 49LAST DIRECT ACCEPTANCE:', 'THIRD ROUND$84,510', 'SECOND ROUND'].join('\n')
    );
    expect(parsed.last_direct_acceptance_rank).toBe(49);
  });

  it('never reads the points table as a cut when the box is blank', () => {
    for (const text of [
      ['LAST DIRECT ACCEPTANCE', 'THIRD ROUND€ 72,865', 'SECOND ROUND', '8'].join('\n'),
      ['LAST DIRECT ACCEPTANCE', 'SECOND ROUND', 'R. Bautista Agut (Right wrist)', '8'].join('\n'),
      ['LAST DIRECT ACCEPTANCE', 'OPEN', '13'].join('\n'),
      ['LAST DIRECT ACCEPTANCE', 'THAILAND TENNIS TOUR 3'].join('\n'),
    ]) {
      expect(parseOfficialPdfCutoffText(text).last_direct_acceptance_rank).toBeNull();
    }
  });

  it('takes the ranking, not the alternate-list place, from "A.Fils 195 - Alt (4)" (Montpellier 2023)', () => {
    const stream = parseOfficialPdfCutoffText(['LAST DIRECT ACCEPTANCE', 'www.ATPTour.com', 'A.Fils 195 - Alt (4)ATP SUPERVISOR(S)'].join('\n'));
    expect(stream.last_direct_acceptance_rank).toBe(195);
    expect(stream.last_direct_acceptance_name).toBe('A.Fils');
    const layout = parseOfficialPdfCutoffText(['LAST DIRECT ACCEPTANCE', 'A.Fils 195 - Alt', '(4)'].join('\n'));
    expect(layout.last_direct_acceptance_rank).toBe(195);
  });

  it('does not let the new rules disturb an ordinary sheet', () => {
    const parsed = parseOfficialPdfCutoffText(['ATP SUPERVISORS', 'Some Name', 'LAST DIRECT ACCEPTANCE', 'Matusevich, Anton - 431', 'ATP SUPERVISOR'].join('\n'));
    expect(parsed.last_direct_acceptance_rank).toBe(431);
  });
});

describe('parseOfficialPdfCutoffText', () => {
  it('counts [Alt] (square bracket) alternates — Glasgow doubles draw style', () => {
    const text = [
      'ALTERNATES/LUCKY LOSERS',
      'J. Kym / A. McHugh [Alt]',
      'A. Knaff / J. Mackinlay [Alt]',
      'WITHDRAWALS',
    ].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.alternate_entries_count).toBe(2);
  });

  it('counts (Alt) and [Alt] mixed notation in same draw', () => {
    const text = [
      'ALTERNATES/LUCKY LOSERS',
      'Smith / Jones (Alt)',
      'Brown / Davis [Alt]',
      'WITHDRAWALS',
    ].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.alternate_entries_count).toBe(2);
  });

  it('extracts both advanced and onsite doubles cuts from same-line format', () => {
    const text = [
      'LAST DIRECT ACCEPTANCE',
      'J. Kym / A. McHugh',
      'Advanced 978 / On-site 1040',
    ].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.challenger_doubles_advanced_cut_rank).toBe(978);
    expect(parsed.challenger_doubles_onsite_cut_rank).toBe(1040);
  });

  it('reads an inline cut value glued to trailing text (Gstaad doubles)', () => {
    const text = 'LAST DIRECT ACCEPTANCE: M.Bortolotti/M.Romios - 215ATP SUPERVISOR(S)Cedric Mourier';
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(215);
    expect(parsed.last_direct_acceptance_name).toMatch(/Bortolotti/);
  });

  it('reads an inline cut after AT DEADLINE / IN DRAW phrasing (Cordoba singles)', () => {
    const text =
      'LAST DIRECT ACCEPTANCE AT DEADLINE D.Schwartzman - 111 LAST DIRECT ACCEPTANCE IN DRAW D.Schwartzman - 111 ATP SUPERVISOR(S)';
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(111);
    expect(parsed.last_direct_acceptance_name).toMatch(/Schwartzman/);
  });

  it('reads a protected-ranking cut on the following line (Brisbane qualifying)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'Kuznetsov, Andrey - P319', 'ATP SUPERVISOR(S)'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(319);
    expect(parsed.last_direct_acceptance_name).toMatch(/Kuznetsov/);
  });

  it('rejects QUARTER-FINALIST draw-round heading as a player name (s-Hertogenbosch doubles)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'QUARTER-FINALIST', '2', 'ALTERNATES'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
  });

  it('rejects the label text captured as player name (Monte Carlo / Barcelona)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'LAST DIRECT ACCEPTANCE IN DRAW', '50', 'Cobolli, Flavio - 50'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_name).not.toMatch(/LAST DIRECT ACCEPTANCE/i);
  });

  it('strips leading seed number from player name (Tokyo draw sheet)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', '1 Fritz, Taylor - 12'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(12);
    expect(parsed.last_direct_acceptance_name).not.toMatch(/^1 /);
    expect(parsed.last_direct_acceptance_name).toMatch(/Fritz/);
  });

  it('strips bracket seeding from player name (Indian Wells draw sheet)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'A. Rublev [5] - 66'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(66);
    expect(parsed.last_direct_acceptance_name).not.toMatch(/\[5\]/);
  });

  it('rejects Madrid combined-ranking notation (D+D / S+S format)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'D+D 88; S+S 414'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
  });

  it('rejects WC wildcard marker as a player name (Hamburg Challenger doubles)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'WC 3'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
  });

  it('reads a bare rank glued between AT DEADLINE / IN DRAW labels (Newport 2023 stream order)', () => {
    const text = 'LAST DIRECT ACCEPTANCE AT DEADLINE246LAST DIRECT ACCEPTANCE IN DRAW246';
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(246);
    expect(parsed.last_direct_acceptance_name).toBeNull();
  });

  it('reads a bare rank on its own line inside the ATP footer box (Newport 2023 layout order)', () => {
    const text = [
      'LAST DIRECT ACCEPTANCE AT DEADLINE',
      '246',
      'LAST DIRECT ACCEPTANCE IN DRAW',
      '246',
      'ATP SUPERVISOR(S)',
    ].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBe(246);
    expect(parsed.last_direct_acceptance_name).toBeNull();
  });

  it('still rejects stray digits after a blank AT DEADLINE footer (Tokyo/Paris seed-number bug)', () => {
    // Blank value: the digits that follow are seed-table ranks, not sandwiched
    // by the IN DRAW label, so they must not be picked up as a cut.
    const text = ['LAST DIRECT ACCEPTANCE AT DEADLINE', '15', 'SEEDED PLAYERS', '35'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.last_direct_acceptance_rank).toBeNull();
  });
});

describe('parseChallengerDoublesCuts', () => {
  it('captures advanced cut from "advance N / onsite M" format (Guangzhou)', () => {
    const text = ['LAST DIRECT ACCEPTANCE', 'advance 650 | onsite 998'].join('\n');
    const parsed = parseOfficialPdfCutoffText(text);
    expect(parsed.challenger_doubles_advanced_cut_rank).toBe(650);
    expect(parsed.challenger_doubles_onsite_cut_rank).toBe(998);
  });
});

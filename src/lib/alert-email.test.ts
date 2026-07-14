import { describe, expect, it } from 'vitest';
import {
  renderDigest,
  renderWelcome,
  splitDigestSections,
  unsubscribeUrl,
  managePrefsUrl,
} from './alert-email';
import { deadlinesForEdition, Deadline } from './entry-deadlines';
import { ScheduleRow } from './types';

function deadline(level: string, kind: string, name = `${level} event`): Deadline {
  const rows: ScheduleRow = {
    edition_id: `e-${name}`,
    tournament_id: 't1',
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    city: 'Testville',
    country: 'USA',
    year: 2026,
    week: 1,
    start_date: '2026-03-16',
    end_date: '2026-03-22',
    level,
    surface: 'Hard',
    indoor: false,
    source: 'test',
    status: 'held',
  };
  const d = deadlinesForEdition(rows).find((x) => x.kind === kind);
  if (!d) throw new Error(`no ${kind} deadline for ${level}`);
  return d;
}

describe('splitDigestSections', () => {
  it('splits into Singles then Doubles, each in descending level order', () => {
    const mixed = [
      deadline('Challenger 75', 'doubles', 'Small Ch'),
      deadline('ATP 250', 'main', 'ATP Event'),
      deadline('ATP 1000', 'doubles', 'Masters'),
      deadline('Challenger 125', 'main', 'Big Ch'),
      deadline('Grand Slam', 'qualifying', 'Wimbledon'),
    ];
    const sections = splitDigestSections(mixed);
    expect(sections.map((s) => s.title)).toEqual(['Singles', 'Doubles']);
    expect(sections[0].deadlines.map((d) => d.name)).toEqual([
      'Wimbledon', // Grand Slam
      'ATP Event', // ATP 250
      'Big Ch', // Challenger 125
    ]);
    expect(sections[1].deadlines.map((d) => d.name)).toEqual([
      'Masters', // ATP 1000
      'Small Ch', // Challenger 75
    ]);
  });

  it('omits an empty section', () => {
    const onlySingles = [deadline('ATP 250', 'main')];
    expect(splitDigestSections(onlySingles).map((s) => s.title)).toEqual(['Singles']);
    const onlyDoubles = [deadline('ATP 250', 'doubles')];
    expect(splitDigestSections(onlyDoubles).map((s) => s.title)).toEqual(['Doubles']);
  });
});

describe('renderDigest sections', () => {
  it('renders Singles and Doubles headings in order, in HTML and text', () => {
    const { html, text } = renderDigest(
      [
        deadline('ATP 250', 'doubles', 'Doubles Event'),
        deadline('ATP 500', 'main', 'Singles Event'),
      ],
      'https://tenniscuts.com',
      'tok'
    );
    const singlesAt = html.indexOf('>Singles</h2>');
    const doublesAt = html.indexOf('>Doubles</h2>');
    expect(singlesAt).toBeGreaterThan(-1);
    expect(doublesAt).toBeGreaterThan(singlesAt);
    expect(html.indexOf('Singles Event')).toBeLessThan(html.indexOf('Doubles Event'));
    expect(text.indexOf('SINGLES')).toBeLessThan(text.indexOf('DOUBLES'));
    // Inside the Doubles section the name drops the redundant " Doubles" suffix.
    expect(html).not.toContain('Doubles Event Doubles');
  });
});

describe('renderWelcome', () => {
  it('lists the chosen tours and links to manage/unsubscribe', () => {
    const { subject, html, text } = renderWelcome({
      origin: 'https://tenniscuts.com',
      token: 'tok123',
      categories: ['grandslam', 'atp'],
      includeDoubles: false,
    });
    expect(subject).toMatch(/subscribed/i);
    expect(html).toContain('Grand Slam');
    expect(html).toContain('ATP Tour');
    expect(html).toContain(managePrefsUrl('https://tenniscuts.com', 'tok123'));
    expect(html).toContain(unsubscribeUrl('https://tenniscuts.com', 'tok123'));
    // No confirmation step advertised.
    expect(text).toMatch(/no confirmation needed/i);
    // Doubles not opted in -> not mentioned.
    expect(html).not.toContain('Doubles (advance entry)');
  });

  it('mentions doubles when opted in', () => {
    const { html, text } = renderWelcome({
      origin: 'https://tenniscuts.com',
      token: 't',
      categories: ['challenger'],
      includeDoubles: true,
    });
    expect(html).toContain('Doubles (advance entry)');
    expect(text).toContain('Doubles (advance entry)');
  });
});

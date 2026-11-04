import { describe, expect, it } from 'vitest';
import { newTournamentMessage, type NewTournament } from './new-tournament-message';

const t = (over: Partial<NewTournament>): NewTournament => ({
  slug: 'canberra-canberra',
  name: 'Canberra',
  city: 'Canberra',
  country: 'Australia',
  level: 'Challenger 125',
  startDate: '2027-01-04',
  year: 2027,
  ...over,
});

describe('newTournamentMessage', () => {
  it('lists new tournaments soonest first, linked to their pages', () => {
    const text = newTournamentMessage(
      [t({ slug: 'quimper-quimper', name: 'Quimper', city: 'Quimper', country: 'France', startDate: '2027-01-25' }), t({})],
      'https://tenniscuts.com'
    );
    expect(text.split('\n')).toEqual([
      '🎾 <b>2 new tournaments on TennisCuts</b>',
      '',
      'Jan 4, 2027 · Challenger 125 · <a href="https://tenniscuts.com/tournaments/canberra-canberra?year=2027">Canberra</a> (Canberra, Australia)',
      'Jan 25, 2027 · Challenger 125 · <a href="https://tenniscuts.com/tournaments/quimper-quimper?year=2027">Quimper</a> (Quimper, France)',
    ]);
  });

  it('says "tournament" for one, escapes names, and caps long lists', () => {
    expect(newTournamentMessage([t({ name: 'Rock & Roll <Open>' })], 'https://x').split('\n')[0]).toBe('🎾 <b>1 new tournament on TennisCuts</b>');
    expect(newTournamentMessage([t({ name: 'Rock & Roll <Open>' })], 'https://x')).toContain('Rock &amp; Roll &lt;Open&gt;');
    const many = Array.from({ length: 45 }, (_, i) => t({ slug: `s${i}`, name: `Event ${String(i).padStart(2, '0')}` }));
    expect(newTournamentMessage(many, 'https://x').split('\n').at(-1)).toBe('…and 5 more');
  });
});

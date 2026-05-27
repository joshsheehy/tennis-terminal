import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import WeekTournamentPicker from './WeekTournamentPicker';
import type { ScheduleRow } from '@/lib/types';

function row(partial: Partial<ScheduleRow> & Pick<ScheduleRow, 'slug' | 'name' | 'week' | 'level' | 'surface' | 'start_date'>): ScheduleRow {
  return {
    edition_id: partial.slug,
    tournament_id: partial.slug,
    city: partial.name,
    country: null,
    year: 2026,
    end_date: partial.start_date,
    indoor: null,
    source: 'test',
    status: 'held',
    ...partial,
  } as ScheduleRow;
}

// Spread across 3 weeks, mixing surfaces (Clay/Hard) and levels (ATP/Challenger).
const tournaments: ScheduleRow[] = [
  row({ slug: 'buenos-aires', name: 'Buenos Aires Challenger', week: 2, start_date: '2026-01-05', end_date: '2026-01-11', level: 'Challenger 50', surface: 'Clay' }),
  row({ slug: 'cordoba',      name: 'Cordoba Open',            week: 3, start_date: '2026-01-12', end_date: '2026-01-18', level: 'ATP 250',        surface: 'Clay' }),
  row({ slug: 'canberra',     name: 'Canberra',                week: 3, start_date: '2026-01-12', end_date: '2026-01-18', level: 'Challenger 125', surface: 'Hard' }),
  row({ slug: 'indian-wells', name: 'BNP Paribas Open',        week: 9, start_date: '2026-03-02', end_date: '2026-03-08', level: 'ATP 1000',       surface: 'Hard' }),
  row({ slug: 'brasilia',     name: 'Brasilia',                week: 9, start_date: '2026-03-02', end_date: '2026-03-08', level: 'Challenger',     surface: 'Clay' }),
  row({ slug: 'thionville',   name: 'Thionville',              week: 9, start_date: '2026-03-02', end_date: '2026-03-08', level: 'Challenger',     surface: 'Hard' }),
];

const isVisible = (el: Element) => (el as HTMLElement).style.display !== 'none';
const weekRows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-week-row]'));
const visibleWeekRows = (root: HTMLElement) => weekRows(root).filter(isVisible);
const details = (root: HTMLElement, key: string) =>
  root.querySelector<HTMLDetailsElement>(`details[data-week-key="${key}"]`)!;
const weekCountText = (root: HTMLElement, key: string) =>
  details(root, key).querySelector('[data-week-count]')!.textContent!.trim();

describe('WeekTournamentPicker pill filtering', () => {
  it('shows all week groups and no hidden rows by default', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('Week 3')).toBeTruthy();
    expect(screen.getByText('Week 9')).toBeTruthy();
    // every week row is visible (no inline display:none)
    expect(visibleWeekRows(container).length).toBe(weekRows(container).length);
  });

  it('keeps the week groups and filters rows when a level pill is clicked', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);
    fireEvent.click(screen.getByRole('button', { name: 'Challenger' }));

    const visible = visibleWeekRows(container);
    // Buenos Aires, Canberra, Brasilia, Thionville
    expect(visible.length).toBe(4);
    expect(visible.every(r => r.getAttribute('data-level-cat') === 'Challenger')).toBe(true);

    // per-week counts reflect the filtered totals
    expect(weekCountText(container, '2')).toBe('1 tournament');
    expect(weekCountText(container, '3')).toBe('1 tournament');
    expect(weekCountText(container, '9')).toBe('2 tournaments');

    // the week-grouped view stays mounted; the flat results list does not take over
    expect(details(container, '9')).toBeTruthy();
  });

  it('filters by surface and combines pills with AND', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clay' }));
    let visible = visibleWeekRows(container);
    expect(visible.length).toBe(3); // Buenos Aires, Cordoba, Brasilia
    expect(visible.every(r => r.getAttribute('data-surface') === 'Clay')).toBe(true);

    // add Challenger → Clay AND Challenger
    fireEvent.click(screen.getByRole('button', { name: 'Challenger' }));
    visible = visibleWeekRows(container);
    expect(visible.length).toBe(2); // Buenos Aires, Brasilia
    expect(visible.every(r =>
      r.getAttribute('data-surface') === 'Clay' && r.getAttribute('data-level-cat') === 'Challenger',
    )).toBe(true);
  });

  it('hides weeks with no matching tournaments', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);
    // Clay + Challenger leaves Week 3 (Cordoba=ATP, Canberra=Hard) empty
    fireEvent.click(screen.getByRole('button', { name: 'Clay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Challenger' }));
    expect(isVisible(details(container, '3'))).toBe(false);
    expect(isVisible(details(container, '2'))).toBe(true);
    expect(isVisible(details(container, '9'))).toBe(true);
  });

  it('restores all rows, weeks and counts when the pill is toggled off', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);
    const challenger = screen.getByRole('button', { name: 'Challenger' });

    fireEvent.click(challenger);
    expect(visibleWeekRows(container).length).toBe(4);

    fireEvent.click(challenger); // toggle off
    expect(visibleWeekRows(container).length).toBe(weekRows(container).length);
    expect(isVisible(details(container, '3'))).toBe(true);
    expect(weekCountText(container, '9')).toBe('3 tournaments');
  });

  it('does not auto-expand weeks when filtering', () => {
    const { container } = render(<WeekTournamentPicker tournaments={tournaments} />);
    const openBefore = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details[data-week-key]'),
    ).filter(d => d.open).length;

    fireEvent.click(screen.getByRole('button', { name: 'Challenger' }));

    const openAfter = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details[data-week-key]'),
    ).filter(d => d.open && isVisible(d)).length;

    // filtering must not open additional week dropdowns
    expect(openAfter).toBeLessThanOrEqual(openBefore);
  });
});

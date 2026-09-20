import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DetailSheetList } from './detail-sheet-list';
import type { DetailSheetEntry } from '@/lib/detail-sheet-index';

function entry(name: string, place: string, level: string, code: string, years: number[]): DetailSheetEntry {
  return {
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    place,
    level,
    code,
    sheets: years.map((year) => ({ year, url: `https://www.protennislive.com/posting/${year}/${code}/ds.pdf` })),
  };
}

const entries = [
  entry('Bari', 'Bari, Italy', 'Challenger 50', '9012', [2026, 2025]),
  entry('Córdoba', 'Córdoba, Argentina', 'ATP 250', '9061', [2026]),
  entry('Genoa', 'Genoa, Italy', 'Challenger 75', '9062', [2026]),
];

const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);

describe('DetailSheetList', () => {
  it('shows every tournament in the order it is given, with a link per year', () => {
    render(<DetailSheetList entries={entries} />);
    expect(names()).toEqual(['Bari', 'Córdoba', 'Genoa']);
    expect(screen.getByText('3 tournaments')).toBeTruthy();

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('https://www.protennislive.com/posting/2026/9012/ds.pdf');
    expect(links).toContain('https://www.protennislive.com/posting/2025/9012/ds.pdf');
  });

  it('filters as you type, ignoring accents and case', () => {
    render(<DetailSheetList entries={entries} />);
    const box = screen.getByLabelText('Search detail sheets');

    fireEvent.change(box, { target: { value: 'CORDOBA' } });
    expect(names()).toEqual(['Córdoba']);
    expect(screen.getByText('1 of 3 tournaments')).toBeTruthy();

    fireEvent.change(box, { target: { value: 'italy' } });
    expect(names()).toEqual(['Bari', 'Genoa']);
  });

  it('says so when nothing matches, and the clear button brings everything back', () => {
    render(<DetailSheetList entries={entries} />);
    fireEvent.change(screen.getByLabelText('Search detail sheets'), { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/No tournaments match/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(names()).toEqual(['Bari', 'Córdoba', 'Genoa']);
  });
});

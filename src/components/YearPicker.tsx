import Link from 'next/link';
import { AVAILABLE_SEASONS } from '@/lib/seasons';

export default function YearPicker({ currentYear }: { currentYear: number }) {
  return (
    <div className="year-tabs" role="group" aria-label="Season">
      {AVAILABLE_SEASONS.map((year) => {
        const active = year === currentYear;
        return (
          <Link
            key={year}
            href={`/cuts?year=${year}`}
            aria-current={active ? 'true' : undefined}
            className={`year-tab${active ? ' year-tab--on' : ''}`}
          >
            {year}
          </Link>
        );
      })}
    </div>
  );
}

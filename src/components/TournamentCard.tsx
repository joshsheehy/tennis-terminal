import Link from 'next/link';
import { ScheduleRow } from '@/lib/types';

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA'; return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateString));
}

// Strip US state abbreviation suffix: "Savannah, GA" → "Savannah"
function displayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

export default function TournamentCard({ tournament }: { tournament: ScheduleRow }) {
  return (
    <Link
      href={`/tournaments/${tournament.slug}`}
      className="block rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm transition hover:border-neutral-700 hover:bg-neutral-950"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{displayName(tournament.name)}</h3>
          <p className="text-sm text-neutral-400">
            {tournament.city}
            {tournament.country ? `, ${tournament.country}` : ''}
          </p>
        </div>
        <span className="rounded-full border border-neutral-700 px-2 py-1 text-xs text-neutral-300">
          {tournament.level}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-neutral-300">
        <div>
          <div className="text-neutral-500">Start</div>
          <div>{formatDate(tournament.start_date)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Surface</div>
          <div>{tournament.surface}</div>
        </div>
      </div>

      <div className="mt-4 text-xs text-neutral-500">
        Open historical cuts →
      </div>
    </Link>
  );
}

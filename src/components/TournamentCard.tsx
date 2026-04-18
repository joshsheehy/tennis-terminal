import Link from 'next/link';
import { ScheduleRow } from '@/lib/types';

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateString));
}

export default function TournamentCard({ row }: { row: ScheduleRow }) {
  return (
    <Link href={`/checker?slug=${row.slug}`} className="block rounded-2xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{row.name}</h3>
          <p className="text-sm text-neutral-400">
            {row.city}
            {row.country ? `, ${row.country}` : ''}
          </p>
        </div>
        <span className="rounded-full border border-neutral-700 px-2 py-1 text-xs text-neutral-300">
          {row.level}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-neutral-300 sm:grid-cols-4">
        <div>
          <div className="text-neutral-500">Start</div>
          <div>{formatDate(row.start_date)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Surface</div>
          <div>{row.surface}</div>
        </div>
        <div>
          <div className="text-neutral-500">Week</div>
          <div>{row.week ?? '—'}</div>
        </div>
        <div>
          <div className="text-neutral-500">Tour</div>
          <div>{row.source === 'atp_tour_pdf' ? 'ATP Tour' : 'Challenger'}</div>
        </div>
      </div>
    </Link>
  );
}

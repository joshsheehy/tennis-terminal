import TournamentCard from '@/components/TournamentCard';
import { getUpcomingSchedule } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const rows = await getUpcomingSchedule(20);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Schedule</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">First 10 ATP Tour + first 10 Challenger events</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          This page reads from the database. Load the official-source-backed calendar importer first, then the events appear here.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          No tournaments found yet. Create the database tables, then run the calendar importer.
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <TournamentCard key={row.edition_id} row={row} />
          ))}
        </div>
      )}
    </main>
  );
}

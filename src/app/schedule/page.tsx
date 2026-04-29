import TournamentCard from '@/components/TournamentCard';
import { getUpcomingSchedule } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const tournaments = await getUpcomingSchedule(20);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Schedule</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Tournament calendar
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Tap any tournament to open its historical detail page and cut data.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          No tournaments found yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {tournaments.map((tournament) => (
            <TournamentCard key={tournament.edition_id} tournament={tournament} />
          ))}
        </div>
      )}
    </main>
  );
}

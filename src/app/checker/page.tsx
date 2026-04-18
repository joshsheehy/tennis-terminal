import CheckerClient from '@/components/CheckerClient';
import { buildDoublesResult, buildSinglesResults } from '@/lib/checker';
import { getCutoffSnapshot, getEditionBySlug, getUpcomingSchedule } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function CheckerPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const params = await searchParams;
  const schedule = await getUpcomingSchedule(1);
  const fallbackSlug = schedule[0]?.slug;
  const slug = params.slug ?? fallbackSlug;

  if (!slug) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          No tournament is available yet. Import calendars first.
        </div>
      </main>
    );
  }

  const tournament = await getEditionBySlug(slug);

  if (!tournament) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          Tournament not found.
        </div>
      </main>
    );
  }

  const singlesMain = await getCutoffSnapshot(tournament.edition_id, 'singles', 'main');
  const singlesQualifying = await getCutoffSnapshot(tournament.edition_id, 'singles', 'qualifying');
  const doublesMain = await getCutoffSnapshot(tournament.edition_id, 'doubles', 'main');

  const singlesResults = buildSinglesResults(9999, singlesMain, singlesQualifying);
  const doublesResult = buildDoublesResult(9999, doublesMain, tournament.level);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Checker</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Entry checker scaffold</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          This page is intentionally checker-first. Once cutoff snapshots are loaded, the logic here can return direct acceptance, alternate spot, or out.
        </p>
      </div>

      <CheckerClient tournament={tournament} singlesResults={singlesResults} doublesResult={doublesResult} />
    </main>
  );
}

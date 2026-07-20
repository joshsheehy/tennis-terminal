import { unstable_cache } from 'next/cache';
import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';

export const dynamic = 'force-dynamic';

const getCachedSchedule = unstable_cache(
  async (year: number) => getScheduleForYear(year),
  ['schedule'],
  // Tag lets /api/sync-canonical and /api/hide-edition bust this cache
  // immediately via revalidateTag('schedule') instead of waiting 5 minutes.
  { revalidate: 300, tags: ['schedule'] },
);

export default async function CutsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string }>;
}) {
  const { year: yearParam, week: weekParam } = await searchParams;
  const year = yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const tournaments = await getCachedSchedule(year);

  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <p className="eyebrow">Entry cuts</p>

        <h1 className="page-title" style={{ marginBottom: 16 }}>Every cut, week by week</h1>

        <YearPicker currentYear={year} />

        <p className="page-lede">
          Open a week to see its tournaments; open a tournament for its full cut history
          and this year&apos;s projection.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>No tournaments found for {year}.</div>
      ) : (
        <WeekTournamentPicker tournaments={tournaments} year={year} defaultWeekKey={weekParam} />
      )}

      <p className="page-footnote">
        Questions, comments, or just want to talk?{' '}
        <a href="mailto:josh@tenniscuts.com">josh@tenniscuts.com</a>
      </p>
    </main>
  );
}

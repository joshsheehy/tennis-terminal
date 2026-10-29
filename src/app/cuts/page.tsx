import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { SITE_NAME } from '@/lib/brand';
import { shareMetadata } from '@/lib/share-meta';

export const dynamic = 'force-dynamic';

const getCachedSchedule = unstable_cache(
  async (year: number) => getScheduleForYear(year),
  ['schedule'],
  // Tag lets /api/sync-canonical and /api/hide-edition bust this cache
  // immediately via revalidateTag('schedule') instead of waiting 5 minutes.
  { revalidate: 300, tags: ['schedule'] },
);


export const metadata: Metadata = {
  title: 'Tournament calendar & entry cuts',
  description:
    'Every ATP, Challenger and ITF tournament, week by week, with the entry cut for each draw and its history.',
  alternates: { canonical: '/cuts' },
  ...shareMetadata({
    title: `Tournament calendar & entry cuts · ${SITE_NAME}`,
    description:
      'Every ATP, Challenger and ITF tournament, week by week, with the entry cut for each draw and its history.',
    path: '/cuts',
  }),
};
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
        <h1 className="page-title" style={{ marginBottom: 16 }}>Tournament calendar</h1>

        <YearPicker currentYear={year} />

        <p className="page-lede">
          Pick a week first, then choose a tournament to open its historical page.
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

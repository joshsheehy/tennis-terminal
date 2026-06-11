import { unstable_cache } from 'next/cache';
import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';

export const dynamic = 'force-dynamic';

const getCachedSchedule = unstable_cache(
  async (year: number) => getScheduleForYear(year),
  ['schedule'],
  { revalidate: 300 },
);

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string }>;
}) {
  const { year: yearParam, week: weekParam } = await searchParams;
  const year = yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const tournaments = await getCachedSchedule(year);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '32px 16px',
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <p
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}
        >
          Schedule
        </p>

        <h1 style={{ margin: 0, marginBottom: 16 }}>Tournament calendar</h1>

        <YearPicker currentYear={year} />

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Pick a week first, then choose a tournament to open its historical page.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>No tournaments found for {year}.</div>
      ) : (
        <WeekTournamentPicker tournaments={tournaments} year={year} defaultWeekKey={weekParam} />
      )}

      <p style={{ marginTop: 48, fontSize: 13, color: 'var(--text-faint)', textAlign: 'center' }}>
        Questions, comments, or just want to talk?{' '}
        <a href="mailto:josh@tenniscuts.com" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
          josh@tenniscuts.com
        </a>
      </p>
    </main>
  );
}

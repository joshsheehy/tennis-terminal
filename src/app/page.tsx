import { unstable_cache } from 'next/cache';
import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_YEARS = [2024, 2025, 2026];

const getCachedSchedule = unstable_cache(
  async (year: number) => getScheduleForYear(year),
  ['schedule'],
  { revalidate: 300 },
);

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const year = yearParam && VALID_YEARS.includes(Number(yearParam)) ? Number(yearParam) : 2026;

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
        <WeekTournamentPicker tournaments={tournaments} year={year} />
      )}
    </main>
  );
}

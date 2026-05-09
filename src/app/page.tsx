import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_YEARS = [2024, 2025, 2026];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const year = yearParam && VALID_YEARS.includes(Number(yearParam)) ? Number(yearParam) : 2026;

  const tournaments = await getScheduleForYear(year);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '32px 16px',
        background: '#ffffff',
        color: '#111111',
        minHeight: '100vh',
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <p
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            color: '#666',
            marginBottom: 8,
          }}
        >
          Schedule
        </p>

        <h1 style={{ margin: 0, marginBottom: 16 }}>Tournament calendar</h1>

        <YearPicker currentYear={year} />

        <p style={{ margin: 0, color: '#444' }}>
          Pick a week first, then choose a tournament to open its historical page.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ color: '#444' }}>No tournaments found for {year}.</div>
      ) : (
        <WeekTournamentPicker tournaments={tournaments} year={year} />
      )}
    </main>
  );
}

import WeekTournamentPicker from '@/components/WeekTournamentPicker';
import { getUpcomingSchedule } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const tournaments = await getUpcomingSchedule(200);

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

        <h1 style={{ margin: 0, marginBottom: 12 }}>Tournament calendar</h1>

        <p style={{ margin: 0, color: '#444' }}>
          Pick a week first, then choose a tournament to open its historical page.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ color: '#444' }}>No tournaments found yet.</div>
      ) : (
        <WeekTournamentPicker tournaments={tournaments} />
      )}
    </main>
  );
}

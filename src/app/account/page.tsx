import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountActions from '@/components/AccountActions';
import RemoveSavedButton from '@/components/RemoveSavedButton';
import { alertsTokenForEmail, listSavedEditionIds } from '@/lib/accounts';
import { currentUserFromCookies } from '@/lib/auth-request';
import { getEditionsWithCutoffsByIds } from '@/lib/db';
import type { ScheduleRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'My schedule',
  robots: { index: false },
};

function displayName(name: string) {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function fmtRange(start: string | null, end: string | null): string {
  const f = (d: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(d));
  if (!start) return 'TBD';
  return end ? `${f(start)} – ${f(end)}` : f(start);
}

// node-postgres hands `date` columns back as a Date at local midnight despite
// the string type, so read the calendar day back out of whichever we got.
function isoDay(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function byStart(a: ScheduleRow, b: ScheduleRow) {
  const ad = isoDay(a.start_date);
  const bd = isoDay(b.start_date);
  if (!ad) return 1;
  if (!bd) return -1;
  return ad < bd ? -1 : ad > bd ? 1 : 0;
}

// A tournament is "past" once its last day is behind us.
function isPast(e: ScheduleRow, today: string): boolean {
  const last = isoDay(e.end_date ?? e.start_date);
  return last != null && last < today;
}

function SavedList({ editions }: { editions: ScheduleRow[] }) {
  return (
    <div className="sched-list">
      {editions.map((e) => (
        <div key={e.edition_id} className="sched-card">
          <div className="sched-card__top">
            <div className="sched-card__title">
              <a href={`/tournaments/${e.slug}?year=${e.year}`} className="sched-card__name">
                {displayName(e.name)}
              </a>
            </div>
            <div className="sched-card__dates">
              {fmtRange(e.start_date, e.end_date)}
              <div>Week {e.week ?? '—'}</div>
            </div>
          </div>
          <p className="sched-card__meta">
            {e.city}
            {e.country ? `, ${e.country}` : ''} · {e.level} · {e.surface}
          </p>
          <div className="sched-actions">
            <RemoveSavedButton editionId={e.edition_id} name={displayName(e.name)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function AccountPage() {
  const user = await currentUserFromCookies();
  if (!user) redirect('/login?next=/account');

  const [ids, alertsToken] = await Promise.all([listSavedEditionIds(user.id), alertsTokenForEmail(user.email)]);
  const rows = await getEditionsWithCutoffsByIds(ids);
  const today = new Date().toISOString().slice(0, 10);
  const editions = rows.map((r) => r.edition).sort(byStart);
  const upcoming = editions.filter((e) => !isPast(e, today));
  const past = editions.filter((e) => isPast(e, today)).reverse();
  const upcomingIds = upcoming.map((e) => e.edition_id).join(',');

  return (
    <main className="page page--slim">
      <div className="sched-head" style={{ margin: '8px 0 8px' }}>
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          My schedule
        </h1>
      </div>
      <p className="page-lede" style={{ marginBottom: 18 }}>
        Signed in as <strong>{user.email}</strong>.
      </p>

      {editions.length === 0 ? (
        <div className="rules-card" style={{ marginBottom: 24 }}>
          <p style={{ margin: 0 }}>
            Nothing saved yet. Use <strong>Save</strong> on any tournament page, or build a run of
            weeks in the <Link href="/">Builder</Link> and save the whole schedule.
          </p>
        </div>
      ) : (
        <>
          <div className="sched-actions" style={{ marginBottom: 14 }}>
            {upcoming.length > 0 && (
              <a href={`/schedule?build=${encodeURIComponent(upcomingIds)}`} className="sched-btn">
                View itinerary
              </a>
            )}
            {upcoming.length > 0 && (
              <a href={`/?build=${encodeURIComponent(upcomingIds)}`} className="sched-btn">
                Open in Builder
              </a>
            )}
          </div>

          <h2 className="section-title">Upcoming</h2>
          {upcoming.length ? (
            <SavedList editions={upcoming} />
          ) : (
            <p className="page-lede">No upcoming tournaments saved.</p>
          )}

          {past.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: 28 }}>
                Past
              </h2>
              <SavedList editions={past} />
            </>
          )}
        </>
      )}

      <h2 className="section-title" style={{ marginTop: 32 }}>
        Email alerts
      </h2>
      <p className="page-lede">
        {alertsToken ? (
          <>
            You get entry-deadline emails at this address.{' '}
            <a href={`/alerts/manage?token=${encodeURIComponent(alertsToken)}`}>Manage alerts</a>
          </>
        ) : (
          <>
            Want an email before entry deadlines? <a href="/alerts">Set up alerts</a>
          </>
        )}
      </p>

      <h2 className="section-title" style={{ marginTop: 32 }}>
        Account
      </h2>
      <AccountActions />
    </main>
  );
}

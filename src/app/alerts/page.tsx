import type { Metadata } from 'next';
import AlertSignup from '@/components/AlertSignup';
import AlertsRules from '@/components/AlertsRules';
import { alertsTokenForEmail } from '@/lib/accounts';
import { currentUserFromCookies } from '@/lib/auth-request';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entry deadline alerts',
  description:
    'Get an email 24, 12 or 2 hours before ATP, Challenger, ITF and Grand Slam entry deadlines.',
};

// Grand Slams lead everywhere (signup form, emails, this list) — they're the
// biggest events and the ones subscribers plan around.
const RULES: Array<{ category: string; rows: Array<[string, string]> }> = [
  {
    category: 'Grand Slam',
    rows: [
      ['Singles main draw', '42 days before'],
      ['Singles qualifying', '28 days before'],
      ['Doubles (advance entry) — optional', '~14 days before (set by each event)'],
    ],
  },
  {
    category: 'ATP Tour (250 / 500 / 1000)',
    rows: [
      ['Singles main draw', '28 days before, 12:00 noon ET'],
      ['Singles qualifying', '21 days before, 12:00 noon ET'],
      ['Doubles (advance entry) — optional', '14 days before, 12:00 noon ET'],
    ],
  },
  {
    category: 'ATP Challenger Tour',
    rows: [
      ['Singles main draw', '21 days before, 12:00 noon ET'],
      ['Singles qualifying', '19 days before (Wed), 12:00 noon ET'],
      ['Doubles (advance entry) — optional', '7 days before, 12:00 noon ET'],
    ],
  },
  {
    category: 'ITF World Tennis Tour',
    rows: [
      ['Entry deadline', '18 days before (Thu), 14:00 GMT'],
      ['Alert style', 'one weekly summary (too many events to list individually)'],
    ],
  },
];

export default async function AlertsPage() {
  // Signed in: pre-fill the address, or skip the form entirely when that
  // address already gets alerts.
  const user = await currentUserFromCookies().catch(() => null);
  const alertsToken = user ? await alertsTokenForEmail(user.email).catch(() => null) : null;

  return (
    <main className="page page--slim">
      <h1 className="page-title" style={{ marginBottom: 8 }}>Entry deadline alerts</h1>
      <p className="page-lede" style={{ marginBottom: 24, fontSize: 16 }}>
        Get an email <strong>24 hours, 12 hours and/or 2 hours before</strong> each entry
        deadline. Choose the tours you care about and when to be reminded — we&apos;ll only
        send you what you pick.
      </p>

      {alertsToken && user ? (
        <section className="card alerts-card alerts-card--subscribed" style={{ marginBottom: 12 }}>
          <p className="alerts-subscribed__title">You&apos;re getting alerts</p>
          <p className="alerts-subscribed__line">
            Deadline emails go to <strong>{user.email}</strong>.
          </p>
          <a className="btn btn--primary" href={`/alerts/manage?token=${encodeURIComponent(alertsToken)}`}>
            Manage alerts
          </a>
        </section>
      ) : (
        <section className="card alerts-card" style={{ marginBottom: 12 }}>
          <AlertSignup defaultEmail={user?.email ?? ''} />
        </section>
      )}
      <p className="page-footnote" style={{ marginBottom: 32 }}>
        We only use your email to send the alerts you pick. See the{' '}
        <a href="/privacy">privacy policy</a>.
      </p>

      <AlertsRules>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          All counted back from the Monday of the tournament week. Singles main draw and qualifying
          are always included; doubles (advance entry) is optional — tick the box when you sign up.
          On-site doubles sign-ins are too fluid to schedule, so they aren&apos;t tracked. Sources:
          2026 ATP Official Rulebook §7.03, 2026 ITF World Tennis Tour Regulations, and the 2026
          Grand Slam Rule Book.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {RULES.map((group) => (
            <div key={group.category} className="rules-card">
              <h3>{group.category}</h3>
              <ul>
                {group.rows.map(([label, when]) => (
                  <li key={label}>
                    <span className="rules-what">{label}</span>
                    <span className="rules-when">{when}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </AlertsRules>
    </main>
  );
}

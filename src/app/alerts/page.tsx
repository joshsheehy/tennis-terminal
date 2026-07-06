import type { Metadata } from 'next';
import AlertSignup from '@/components/AlertSignup';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entry deadline alerts',
  description:
    'Get an email 24 hours before ATP, Challenger, ITF and Grand Slam entry deadlines.',
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

export default function AlertsPage() {
  return (
    <main className="page page--slim">
      <p className="eyebrow">Alerts</p>
      <h1 className="page-title" style={{ marginBottom: 8 }}>Entry deadline alerts</h1>
      <p className="page-lede" style={{ marginBottom: 24, fontSize: 16 }}>
        Get an email <strong>24 hours before</strong> each entry deadline. Choose the tours you
        care about — we&apos;ll only send you what you pick.
      </p>

      <section className="card" style={{ marginBottom: 32 }}>
        <AlertSignup />
      </section>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px', color: 'var(--text-strong)' }}>
        The deadlines we track
      </h2>
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
    </main>
  );
}

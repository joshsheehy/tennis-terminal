import type { Metadata } from 'next';
import AlertSignup from '@/components/AlertSignup';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entry deadline alerts',
  description:
    'Get an email 24 hours before ATP, Challenger, ITF and Grand Slam entry deadlines.',
};

const RULES: Array<{ category: string; rows: Array<[string, string]> }> = [
  {
    category: 'ATP Tour (250 / 500 / 1000)',
    rows: [
      ['Singles main draw', '28 days before, 12:00 noon ET'],
      ['Singles qualifying', '21 days before, 12:00 noon ET'],
      ['Doubles main draw', '14 days before, 12:00 noon ET'],
    ],
  },
  {
    category: 'ATP Challenger Tour',
    rows: [
      ['Singles main draw', '21 days before, 12:00 noon ET'],
      ['Singles qualifying', '19 days before (Wed), 12:00 noon ET'],
      ['Doubles main draw', '7 days before, 12:00 noon ET'],
    ],
  },
  {
    category: 'ITF World Tennis Tour',
    rows: [['Entry deadline', '18 days before (Thu), 14:00 GMT']],
  },
  {
    category: 'Grand Slam',
    rows: [['Main draw entry', '~6 weeks (42 days) before']],
  },
];

export default function AlertsPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 16px',
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: 'calc(100dvh - var(--nav-h))',
      }}
    >
      <p
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        Alerts
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>
        Entry deadline alerts
      </h1>
      <p style={{ fontSize: 16, color: 'var(--text-muted)', margin: '0 0 24px', lineHeight: 1.5 }}>
        Get an email <strong>24 hours before</strong> each entry deadline. Choose the tours you
        care about — we&apos;ll only send you what you pick.
      </p>

      <section
        style={{
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 12,
          padding: 20,
          marginBottom: 32,
          background: 'var(--card, transparent)',
        }}
      >
        <AlertSignup />
      </section>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>
        The deadlines we track
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
        All counted back from the Monday of the tournament week. Sources: 2026 ATP Official
        Rulebook §7.03, 2026 ITF World Tennis Tour Regulations, and the Grand Slam entry standard.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RULES.map((group) => (
          <div key={group.category}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>{group.category}</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
              {group.rows.map(([label, when]) => (
                <li key={label}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}:</span> {when}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}

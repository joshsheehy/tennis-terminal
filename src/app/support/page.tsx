import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { SITE_NAME } from '@/lib/brand';
import { shareMetadata } from '@/lib/share-meta';

// The App Store "Support URL": how to reach us, plus answers to the questions
// people actually hit (sign-in codes, notifications, deleting an account,
// where the numbers come from).
export const metadata: Metadata = {
  title: 'Support',
  description: 'Help with Tennis Cuts: sign-in, alerts, your account, and where the data comes from.',
  ...shareMetadata({
    title: `Support · ${SITE_NAME}`,
    description: 'Help with TennisCuts: sign-in, alerts, your account, and where the data comes from.',
    path: '/support',
  }),
};

const sectionStyle: CSSProperties = { margin: '0 0 24px' };
const h2Style: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: '0 0 8px',
  color: 'var(--text-strong)',
};
const pStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  margin: '0 0 8px',
};

export default function SupportPage() {
  return (
    <main className="page page--slim">
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Support
      </h1>
      <p className="page-lede" style={{ marginBottom: 28, fontSize: 15 }}>
        Questions, a cut that looks wrong, or an idea for the app? Email{' '}
        <a href="mailto:josh@tenniscuts.com">josh@tenniscuts.com</a> and we&apos;ll get back to you,
        usually within a day.
      </p>

      <section style={sectionStyle}>
        <h2 style={h2Style}>My sign-in code didn&apos;t arrive</h2>
        <p style={pStyle}>
          Codes usually arrive within a minute. Check your spam or promotions folder, make sure the
          address is spelled right, and tap <strong>Send a new code</strong> if it&apos;s been a
          few minutes. Each code works for 10 minutes.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>I&apos;m not getting push notifications</h2>
        <p style={pStyle}>
          In the app, open <strong>Alerts</strong> and make sure <strong>Push notifications</strong>{' '}
          is on, then tap <strong>Send test notification</strong>. If nothing arrives, check iPhone{' '}
          <strong>Settings → TennisCuts → Notifications</strong> and allow notifications.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Changing or stopping alerts</h2>
        <p style={pStyle}>
          In the app, the <strong>Alerts</strong> tab controls which tours, which deadlines and when
          you&apos;re reminded, for both push and email. Every alert email also has its own
          unsubscribe and manage-preferences links.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Deleting your account</h2>
        <p style={pStyle}>
          Open <strong>Saved</strong>, scroll to <strong>Account</strong>, and tap{' '}
          <strong>Delete account</strong>. That permanently erases your account and saved
          tournaments right away. See the <a href="/privacy">privacy policy</a> for details.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Where the numbers come from</h2>
        <p style={pStyle}>
          Entry cutoffs, schedules and deadlines are compiled from publicly posted tournament
          entry lists, draw sheets and official calendars. Cuts shift with withdrawals, so treat
          them as a guide and confirm with the tournament or your player portal before entering.
          Spot something wrong? Email us and we&apos;ll fix it.
        </p>
        <p style={pStyle}>
          Tennis Cuts is an independent tool and isn&apos;t affiliated with or endorsed by the ATP,
          the ITF or any tournament.
        </p>
      </section>
    </main>
  );
}

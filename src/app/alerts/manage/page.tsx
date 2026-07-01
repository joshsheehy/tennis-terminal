import type { Metadata } from 'next';
import ManagePreferences from '@/components/ManagePreferences';
import { getSubscriberByToken } from '@/lib/subscribers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit alert preferences',
  robots: { index: false },
};

const shell = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '32px 16px',
  background: 'var(--bg)',
  color: 'var(--text)',
  minHeight: 'calc(100dvh - var(--nav-h))',
} as const;

export default async function ManageAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const subscriber = token ? await getSubscriberByToken(token) : null;

  if (!subscriber) {
    return (
      <main style={shell}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Edit alert preferences</h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This link is invalid or has expired. You can{' '}
          <a href="/alerts">sign up again</a> to reset your preferences.
        </p>
      </main>
    );
  }

  return (
    <main style={shell}>
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
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 20px' }}>Edit your preferences</h1>
      <section
        style={{
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 12,
          padding: 20,
          background: 'var(--card, transparent)',
        }}
      >
        <ManagePreferences
          token={subscriber.unsubscribe_token}
          email={subscriber.email}
          initialCategories={subscriber.categories}
        />
      </section>
    </main>
  );
}

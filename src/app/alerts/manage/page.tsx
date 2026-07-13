import type { Metadata } from 'next';
import ManagePreferences from '@/components/ManagePreferences';
import { getSubscriberByToken } from '@/lib/subscribers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit alert preferences',
  robots: { index: false },
};


export default async function ManageAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const subscriber = token ? await getSubscriberByToken(token) : null;

  if (!subscriber) {
    return (
      <main className="page page--tight">
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-strong)' }}>Edit alert preferences</h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This link is invalid or has expired. You can{' '}
          <a href="/alerts" style={{ color: 'var(--brand-ink)', textDecoration: 'underline', textUnderlineOffset: 2 }}>sign up again</a> to reset your preferences.
        </p>
      </main>
    );
  }

  return (
    <main className="page page--tight">
      <p className="eyebrow">Alerts</p>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 20px', color: 'var(--text-strong)' }}>Edit your preferences</h1>
      <section className="card">
        <ManagePreferences
          token={subscriber.unsubscribe_token}
          email={subscriber.email}
          initialCategories={subscriber.categories}
          initialIncludeDoubles={subscriber.include_doubles}
          initialReminderHours={subscriber.reminder_hours}
        />
      </section>
    </main>
  );
}

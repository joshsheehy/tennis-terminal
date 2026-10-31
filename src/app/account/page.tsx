import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import AccountActions from '@/components/AccountActions';
import AlertOffer from '@/components/AlertOffer';
import SavedTournaments from '@/components/SavedTournaments';
import { alertsTokenForEmail, listSavedEditionIds } from '@/lib/accounts';
import { currentUserFromCookies } from '@/lib/auth-request';
import { getEditionsWithCutoffsByIds } from '@/lib/db';
import { APP_USER_AGENT_TOKEN } from '@/lib/nav';
import { defaultPhase, groupSaved, relativeLabel, type Phase, type SavedItem } from '@/lib/saved-schedule';
import { getAlertPrefsForEmail } from '@/lib/subscribers';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Saved',
  robots: { index: false },
};

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

export default async function AccountPage() {
  const user = await currentUserFromCookies();
  if (!user) redirect('/login?next=/account');

  const [ids, alertsToken, alertPrefs] = await Promise.all([
    listSavedEditionIds(user.id),
    alertsTokenForEmail(user.email),
    // Only for the alerts offer; a failed lookup just means no offer.
    getAlertPrefsForEmail(user.email).catch(() => null),
  ]);
  const rows = await getEditionsWithCutoffsByIds(ids);
  const inApp = ((await headers()).get('user-agent') ?? '').includes(APP_USER_AGENT_TOKEN);
  const today = new Date().toISOString().slice(0, 10);

  const items: SavedItem[] = rows.map(({ edition: e }) => ({
    editionId: e.edition_id,
    slug: e.slug,
    year: e.year,
    name: e.name,
    city: e.city,
    country: e.country,
    level: e.level,
    start: isoDay(e.start_date),
    end: isoDay(e.end_date),
  }));
  const grouped = groupSaved(items, today);
  const withLabels = Object.fromEntries(
    (Object.keys(grouped) as Phase[]).map((k) => [k, grouped[k].map((i) => ({ ...i, label: relativeLabel(i, today) }))])
  ) as Record<Phase, (SavedItem & { label: string })[]>;

  return (
    <main className="page page--slim">
      <h1 className="page-title" style={{ marginBottom: 16 }}>
        Saved
      </h1>

      {/* Any stored preferences — even email switched off — mean they've already chosen. */}
      {alertPrefs && !alertPrefs.exists && <AlertOffer email={user.email} />}

      <SavedTournaments groups={withLabels} initialPhase={defaultPhase(grouped)} />

      <section className="account-box">
        <h2 className="section-title">Account</h2>
        <p className="account-box__line">
          Signed in as <strong>{user.email}</strong>
        </p>
        <p className="account-box__line">
          {inApp ? (
            // The app's Alerts tab holds every alert setting (push and email).
            <a href="/alerts">Alert settings</a>
          ) : alertsToken ? (
            <a href={`/alerts/manage?token=${encodeURIComponent(alertsToken)}`}>Manage email alerts</a>
          ) : (
            <a href="/alerts">Get email alerts before entry deadlines</a>
          )}
        </p>
        <p className="account-box__line">
          <a href="/support">Help &amp; support</a> · <a href="/privacy">Privacy policy</a>
        </p>
        <AccountActions />
      </section>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { CATEGORY_OPTIONS, REMINDER_OPTIONS } from '@/components/AlertSignup';
import { accountApi } from '@/lib/account-client';
import { enablePush, isNativeApp } from '@/lib/native-push';

// One-tap alerts offer on the Saved page, shown only to a signed-in account
// that has no alert preferences yet. Signing in never subscribes anyone; this
// asks once. "Turn on" saves the same defaults as the signup form (Grand
// Slam, ATP, Challenger · 24 hours before); "Not now" hides it on this device.

export const OFFER_DISMISSED_KEY = 'alerts.offer.dismissed';

const BASIC = {
  categories: CATEGORY_OPTIONS.filter((c) => c.defaultOn).map((c) => c.key),
  includeDoubles: false,
  reminderHours: REMINDER_OPTIONS.filter((r) => r.defaultOn).map((r) => r.hours),
};

type Phase = 'hidden' | 'offer' | 'done';

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function AlertOffer({ email }: { email: string }) {
  // Hidden until mounted: the dismissal lives in localStorage, so rendering
  // on the server would flash the card for people who already said no.
  const [phase, setPhase] = useState<Phase>('hidden');
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<'push' | 'email'>('email');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNative(isNativeApp());
    try {
      if (localStorage.getItem(OFFER_DISMISSED_KEY)) return;
    } catch {
      // storage blocked — still offer
    }
    setPhase('offer');
  }, []);

  async function turnOnEmail() {
    setBusy(true);
    setError(null);
    const result = await accountApi('/api/alerts/prefs', 'PUT', { ...BASIC, emailOn: true });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChannel('email');
    setPhase('done');
  }

  // Registering the phone also creates the account's preferences with these
  // same defaults (email left off) — see /api/push/register.
  async function turnOnPush() {
    setBusy(true);
    setError(null);
    try {
      const result = await enablePush();
      if (!result.ok) {
        setError(result.reason === 'denied' ? `${result.message} Or get them by email instead.` : result.message);
        return;
      }
      setChannel('push');
      setPhase('done');
    } catch (err) {
      setError(`Couldn't turn on notifications: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(OFFER_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setPhase('hidden');
  }

  if (phase === 'hidden') return null;

  if (phase === 'done') {
    return (
      <section className="alert-offer alert-offer--done" aria-label="Deadline alerts" role="status">
        <div className="alert-offer__head">
          <CheckIcon />
          <h2 className="alert-offer__title">Alerts are on</h2>
        </div>
        <p className="alert-offer__text alert-offer__text--last">
          {channel === 'push' ? 'You’ll get a notification' : <>We’ll email <strong>{email}</strong></>} 24 hours
          before Grand Slam, ATP and Challenger entry deadlines. <a href="/alerts">Change in Alerts</a>
        </p>
      </section>
    );
  }

  return (
    <section className="alert-offer" aria-label="Deadline alerts">
      <div className="alert-offer__head">
        <BellIcon />
        <h2 className="alert-offer__title">Get entry-deadline alerts?</h2>
      </div>
      <p className="alert-offer__text">
        We&rsquo;ll remind you <strong>24 hours before</strong> entries close for{' '}
        <strong>Grand Slam, ATP and Challenger</strong> events.
      </p>
      <div className="alert-offer__actions">
        {native ? (
          <>
            <button type="button" className="btn btn--primary" onClick={turnOnPush} disabled={busy}>
              Turn on notifications
            </button>
            <button type="button" className="btn" onClick={turnOnEmail} disabled={busy}>
              Email me instead
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={turnOnEmail} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on email alerts'}
          </button>
        )}
        <button type="button" className="alert-offer__later" onClick={dismiss} disabled={busy}>
          Not now
        </button>
      </div>
      {error && (
        <p className="form-status form-status--error alert-offer__error" role="alert">
          {error}
        </p>
      )}
      <p className="alert-offer__fine">
        {native ? 'Change' : <>Sent to {email} · change</>} tours or timing anytime in <a href="/alerts">Alerts</a>.
      </p>
    </section>
  );
}

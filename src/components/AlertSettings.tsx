'use client';

import { useEffect, useRef, useState } from 'react';
import AlertSignup, { CATEGORY_OPTIONS, REMINDER_OPTIONS } from '@/components/AlertSignup';
import { accountApi, type ApiResult } from '@/lib/account-client';
import {
  disablePush,
  enablePush,
  isNativeApp,
  loadStandalonePush,
  saveStandalonePrefs,
  sendTestPush,
  storedPushToken,
  type DevicePrefs,
} from '@/lib/native-push';

// The iOS app's Alerts screen. The switches up top say how to be told; until
// one is on, the choices below (tours, doubles, timing) are greyed out and
// locked, so it's obvious alerts are off. Every change saves immediately, no
// submit button. Two versions:
//   AlertSettings       signed in: push on this phone and/or email, one set of
//                       account preferences for both.
//   PhoneAlertSettings  signed out: push only, with the phone's own
//                       preferences; adding an email signs in.
// Reuses the alerts-form / alerts-group markup so the app's switch styling
// applies.

export type AlertPrefs = {
  categories: string[];
  includeDoubles: boolean;
  reminderHours: number[];
  emailOn: boolean;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEFAULT_PREFS: DevicePrefs = {
  categories: CATEGORY_OPTIONS.filter((c) => c.defaultOn).map((c) => c.key),
  includeDoubles: false,
  reminderHours: REMINDER_OPTIONS.filter((r) => r.defaultOn).map((r) => r.hours),
};

const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function Switch({ label, checked, onChange, disabled }: { label: React.ReactNode; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={`check-option${checked ? ' check-option--on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

// Debounced auto-save, so flipping several switches is one request.
function useAutoSave<P>(save: (prefs: P) => Promise<ApiResult>) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queue(prefs: P) {
    setError(null);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await save(prefs);
      setState(result.ok ? 'saved' : 'error');
      if (!result.ok) setError(result.error);
    }, 400);
  }
  return { state, error, setError, queue };
}

function invalid(prefs: DevicePrefs): string | null {
  if (prefs.categories.length === 0) return 'Keep at least one tour on.';
  if (prefs.reminderHours.length === 0) return 'Keep at least one reminder time on.';
  return null;
}

// Tours, doubles and timing. `off` greys the whole block and locks it.
function PrefFields({ prefs, onChange, off }: { prefs: DevicePrefs; onChange: (next: DevicePrefs) => void; off: boolean }) {
  return (
    <div className={`alerts-settings__body${off ? ' alerts-settings__body--off' : ''}`} aria-disabled={off || undefined}>
      <fieldset className="alerts-group" disabled={off} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Which deadlines</legend>
        {CATEGORY_OPTIONS.map((opt) => (
          <Switch
            key={opt.key}
            label={opt.label}
            checked={prefs.categories.includes(opt.key)}
            onChange={() => onChange({ ...prefs, categories: toggleIn(prefs.categories, opt.key) })}
            disabled={off}
          />
        ))}
      </fieldset>

      <div className="alerts-group alerts-group--doubles">
        <Switch
          label="Also doubles (advance entry)"
          checked={prefs.includeDoubles}
          onChange={() => onChange({ ...prefs, includeDoubles: !prefs.includeDoubles })}
          disabled={off}
        />
      </div>

      <fieldset className="alerts-group" disabled={off} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Remind me</legend>
        <div className="alerts-reminders" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {REMINDER_OPTIONS.map((opt) => (
            <Switch
              key={opt.hours}
              label={opt.label}
              checked={prefs.reminderHours.includes(opt.hours)}
              onChange={() => onChange({ ...prefs, reminderHours: toggleIn(prefs.reminderHours, opt.hours) })}
              disabled={off}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function TestButton() {
  const [state, setState] = useState<string | null>(null);
  async function send() {
    setState('Sending…');
    const result = await sendTestPush();
    setState(result.ok ? 'Sent. It should arrive in a few seconds.' : result.error);
  }
  return (
    <div className="alerts-settings__test">
      <button type="button" className="link-button" onClick={send}>
        Send test notification
      </button>
      {state && <p className="alerts-settings__hint">{state}</p>}
    </div>
  );
}

function SaveStatus({ error, state }: { error: string | null; state: SaveState }) {
  return (
    <p role="status" className={`form-status ${error || state === 'error' ? 'form-status--error' : 'form-status--ok'}`}>
      {error ?? (state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : '')}
    </p>
  );
}

// Push on/off for this phone, with the plugin's own message on failure (a
// silent failure leaves the switch stuck with no clue why).
function usePushSwitch(onEnabled: (prefs: DevicePrefs | null) => void) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        const result = await enablePush();
        if (result.ok) {
          setOn(true);
          onEnabled(result.prefs);
        } else setError(result.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[push] toggle failed', err);
      setError(`Couldn't turn on push: ${message}`);
    } finally {
      setBusy(false);
    }
  }
  return { on, setOn, busy, error, toggle };
}

export default function AlertSettings({ email, initial }: { email: string; initial: AlertPrefs }) {
  const [prefs, setPrefs] = useState<AlertPrefs>(initial);
  const [native, setNative] = useState(false);
  const push = usePushSwitch(() => {});
  const save = useAutoSave((next: AlertPrefs) => accountApi('/api/alerts/prefs', 'PUT', next));
  const { setOn: setPushOn } = push;

  useEffect(() => {
    setNative(isNativeApp());
    setPushOn(Boolean(storedPushToken()));
  }, [setPushOn]);

  function update(next: AlertPrefs) {
    const problem = invalid(next);
    if (problem) return save.setError(problem);
    setPrefs(next);
    save.queue(next);
  }

  const off = !prefs.emailOn && !push.on;

  return (
    <div className="alerts-form alerts-settings" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <fieldset className={`alerts-group alerts-group--master${off ? ' alerts-group--master-off' : ''}`} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Notify me by</legend>
        {native && (
          <Switch
            label={<span className="alerts-master__label"><BellIcon /> Push notifications</span>}
            checked={push.on}
            onChange={push.toggle}
            disabled={push.busy}
          />
        )}
        <Switch label={`Email (${email})`} checked={prefs.emailOn} onChange={() => update({ ...prefs, emailOn: !prefs.emailOn })} />
      </fieldset>
      {push.error && <p className="form-status form-status--error">{push.error}</p>}
      {off ? (
        <p className="alerts-settings__off">Alerts are off. Turn on {native ? 'push or email' : 'email'} to choose your deadlines.</p>
      ) : (
        native && push.on && <TestButton />
      )}

      <PrefFields prefs={prefs} onChange={(next) => update({ ...next, emailOn: prefs.emailOn })} off={off} />
      <SaveStatus error={save.error} state={save.state} />
    </div>
  );
}

// Signed out, in the app: push without an account.
export function PhoneAlertSettings() {
  // The server renders this only inside the app, so assume the native bridge
  // until mounted (keeps the first render identical on server and client).
  const [native, setNative] = useState(true);
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const push = usePushSwitch((next) => next && setPrefs(next));
  const save = useAutoSave((next: DevicePrefs) => saveStandalonePrefs(next));
  const { setOn: setPushOn } = push;
  const { setError: setSaveError } = save;

  useEffect(() => {
    if (!isNativeApp()) {
      setNative(false);
      return;
    }
    loadStandalonePush()
      .then((state) => {
        setPushOn(state.on);
        if (state.prefs) setPrefs(state.prefs);
        if (state.error) setSaveError(state.error);
      })
      .finally(() => setLoading(false));
  }, [setPushOn, setSaveError]);

  // Not really the app (no native bridge): the email form still works.
  if (!native) return <AlertSignup />;

  function update(next: DevicePrefs) {
    const problem = invalid(next);
    if (problem) return save.setError(problem);
    setPrefs(next);
    save.queue(next);
  }

  const off = !push.on;

  return (
    <div className="alerts-form alerts-settings" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className={`alerts-group alerts-group--master${off ? ' alerts-group--master-off' : ''}`}>
        <Switch
          label={<span className="alerts-master__label"><BellIcon /> Push notifications</span>}
          checked={push.on}
          onChange={push.toggle}
          disabled={push.busy || loading}
        />
      </div>
      {push.error && <p className="form-status form-status--error">{push.error}</p>}
      {off ? (
        <p className="alerts-settings__off">Push notifications are off. Turn them on to choose your deadlines.</p>
      ) : (
        <TestButton />
      )}

      <PrefFields prefs={prefs} onChange={update} off={off} />
      <SaveStatus error={save.error} state={save.state} />

      <EmailSignIn pushOn={push.on} prefs={prefs} />
    </div>
  );
}

type AccountPrefsReply = { exists: boolean; categories: string[]; includeDoubles: boolean; reminderHours: number[] };

// Optional: adding an email signs in with a one-time code (the same account as
// Saved), turns email alerts on, and brings this phone's push along.
function EmailSignIn({ pushOn, prefs }: { pushOn: boolean; prefs: DevicePrefs }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await accountApi('/api/auth/request-code', 'POST', { email });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setStep('code');
    setCode('');
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const verified = await accountApi('/api/auth/verify', 'POST', { email, code });
    if (!verified.ok) {
      setBusy(false);
      return setError(verified.error);
    }
    // Signed in now. Registering again moves this phone onto the account (an
    // account without alert preferences takes the phone's).
    const token = storedPushToken();
    if (token) await accountApi('/api/push/register', 'POST', { token });
    const current = await accountApi<AccountPrefsReply>('/api/alerts/prefs');
    const base = current.ok && current.exists ? current : prefs;
    await accountApi('/api/alerts/prefs', 'PUT', {
      categories: base.categories,
      includeDoubles: base.includeDoubles,
      reminderHours: base.reminderHours,
      emailOn: true,
    });
    window.location.reload();
  }

  return (
    <section className="alerts-email" aria-label="Email alerts">
      <h2 className="alerts-email__title">{pushOn ? 'Also get them by email?' : 'Rather get them by email?'}</h2>
      {step === 'email' ? (
        <form onSubmit={requestCode} className="alerts-email__row">
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="field-input"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Sending…' : 'Add'}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="alerts-email__row">
          <input
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            aria-label="6-digit code"
            className="field-input"
            autoFocus
          />
          <button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
      <p className="alerts-email__fine">
        {step === 'email' ? (
          'We’ll send a 6-digit code to confirm it’s you. This also signs you in, so your alerts and Saved schedule follow you to a new phone.'
        ) : (
          <>
            We sent a code to <strong>{email.trim()}</strong>.{' '}
            <button type="button" className="link-button" onClick={() => setStep('email')} disabled={busy}>
              Use a different email
            </button>
          </>
        )}
      </p>
    </section>
  );
}

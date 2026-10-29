'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORY_OPTIONS, REMINDER_OPTIONS } from '@/components/AlertSignup';
import { accountApi } from '@/lib/account-client';
import { disablePush, enablePush, isNativeApp, storedPushToken } from '@/lib/native-push';

// The iOS app's Alerts screen for a signed-in account: how to be told
// (push on this phone, email) and what about (tours, doubles, timing). One
// set of preferences drives both channels. Every change saves immediately.
// Reuses the alerts-form / alerts-group markup so the app's switch styling
// applies.

export type AlertPrefs = {
  categories: string[];
  includeDoubles: boolean;
  reminderHours: number[];
  emailOn: boolean;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={`check-option${checked ? ' check-option--on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

export default function AlertSettings({ email, initial }: { email: string; initial: AlertPrefs }) {
  const [prefs, setPrefs] = useState<AlertPrefs>(initial);
  const [save, setSave] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [testState, setTestState] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNative(isNativeApp());
    setPushOn(Boolean(storedPushToken()));
  }, []);

  function update(next: AlertPrefs) {
    if (next.categories.length === 0) {
      setError('Keep at least one tour on.');
      return;
    }
    if (next.reminderHours.length === 0) {
      setError('Keep at least one reminder time on.');
      return;
    }
    setError(null);
    setPrefs(next);
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    // Short debounce so flipping several switches is one save.
    timer.current = setTimeout(async () => {
      const result = await accountApi('/api/alerts/prefs', 'PUT', next);
      setSave(result.ok ? 'saved' : 'error');
      if (!result.ok) setError(result.error);
    }, 400);
  }

  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  async function togglePush() {
    setPushBusy(true);
    setError(null);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        const result = await enablePush();
        if (result.ok) setPushOn(true);
        else setError(result.message);
      }
    } catch (err) {
      // Surface the plugin's own message — a silent failure leaves the switch
      // stuck with no clue why.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[push] toggle failed', err);
      setError(`Couldn't turn on push: ${message}`);
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTest() {
    setTestState('Sending…');
    const result = await accountApi('/api/push/test', 'POST', {});
    setTestState(result.ok ? 'Sent. It should arrive in a few seconds.' : result.error);
  }

  const nothingOn = !prefs.emailOn && !pushOn;

  return (
    <div className="alerts-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <fieldset className="alerts-group" style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Notify me by</legend>
        {native && <Switch label="Push notifications" checked={pushOn} onChange={togglePush} disabled={pushBusy} />}
        <Switch label={`Email (${email})`} checked={prefs.emailOn} onChange={() => update({ ...prefs, emailOn: !prefs.emailOn })} />
      </fieldset>
      {nothingOn && <p className="alerts-settings__hint">Alerts are off. Turn on push or email to get deadline reminders.</p>}
      {native && pushOn && (
        <div className="alerts-settings__test">
          <button type="button" className="btn" onClick={sendTest}>
            Send test notification
          </button>
          {testState && <p className="alerts-settings__hint">{testState}</p>}
        </div>
      )}

      <fieldset className="alerts-group" style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Which deadlines</legend>
        {CATEGORY_OPTIONS.map((opt) => (
          <Switch
            key={opt.key}
            label={opt.label}
            checked={prefs.categories.includes(opt.key)}
            onChange={() => update({ ...prefs, categories: toggleIn(prefs.categories, opt.key) })}
          />
        ))}
      </fieldset>

      <div className="alerts-group alerts-group--doubles">
        <Switch
          label="Also doubles (advance entry)"
          checked={prefs.includeDoubles}
          onChange={() => update({ ...prefs, includeDoubles: !prefs.includeDoubles })}
        />
      </div>

      <fieldset className="alerts-group" style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Remind me</legend>
        <div className="alerts-reminders" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {REMINDER_OPTIONS.map((opt) => (
            <Switch
              key={opt.hours}
              label={opt.label}
              checked={prefs.reminderHours.includes(opt.hours)}
              onChange={() => update({ ...prefs, reminderHours: toggleIn(prefs.reminderHours, opt.hours) })}
            />
          ))}
        </div>
      </fieldset>

      <p role="status" className={`form-status ${error || save === 'error' ? 'form-status--error' : 'form-status--ok'}`}>
        {error ?? (save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : '')}
      </p>
    </div>
  );
}

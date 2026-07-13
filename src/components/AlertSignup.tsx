'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'ok' | 'error';

// Keep in sync with Category / CATEGORY_LABEL in src/lib/entry-deadlines.ts.
const CATEGORY_OPTIONS: Array<{ key: string; label: string; defaultOn: boolean }> = [
  { key: 'grandslam', label: 'Grand Slam', defaultOn: true },
  { key: 'atp', label: 'ATP Tour (250 / 500 / 1000)', defaultOn: true },
  { key: 'challenger', label: 'ATP Challenger Tour', defaultOn: true },
  { key: 'itf', label: 'ITF World Tennis Tour', defaultOn: false },
];

// Keep in sync with REMINDER_WINDOWS in src/lib/entry-deadlines.ts.
const REMINDER_OPTIONS: Array<{ hours: number; label: string; defaultOn: boolean }> = [
  { hours: 24, label: '24 hours before', defaultOn: true },
  { hours: 12, label: '12 hours before', defaultOn: false },
  { hours: 1, label: '1 hour before', defaultOn: false },
];

export default function AlertSignup() {
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CATEGORY_OPTIONS.filter((c) => c.defaultOn).map((c) => c.key))
  );
  const [reminders, setReminders] = useState<Set<number>>(
    () => new Set(REMINDER_OPTIONS.filter((r) => r.defaultOn).map((r) => r.hours))
  );
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const [doubles, setDoubles] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleReminder(hours: number) {
    setReminders((prev) => {
      const next = new Set(prev);
      if (next.has(hours)) next.delete(hours);
      else next.add(hours);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setStatus('error');
      setMessage('Pick at least one category.');
      return;
    }
    if (reminders.size === 0) {
      setStatus('error');
      setMessage('Pick at least one reminder time.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          categories: Array.from(selected),
          doubles,
          reminderHours: Array.from(reminders),
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        setStatus('ok');
        setMessage(data.message ?? "You're signed up.");
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
          Which deadlines do you want?
        </legend>
        {CATEGORY_OPTIONS.map((opt) => (
          <label
            key={opt.key}
            className={`check-option${selected.has(opt.key) ? ' check-option--on' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(opt.key)}
              onChange={() => toggle(opt.key)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 12 }}>
        <label className={`check-option${doubles ? ' check-option--on' : ''}`}>
          <input type="checkbox" checked={doubles} onChange={() => setDoubles((v) => !v)} />
          Also send doubles (advance entry)
        </label>
        <p style={{ margin: '6px 0 0 28px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Adds the doubles advance-entry deadline for the tours you picked. On-site
          doubles sign-ins aren&apos;t tracked.
        </p>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
          When should we email you?
        </legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {REMINDER_OPTIONS.map((opt) => (
            <label
              key={opt.hours}
              className={`check-option${reminders.has(opt.hours) ? ' check-option--on' : ''}`}
            >
              <input
                type="checkbox"
                checked={reminders.has(opt.hours)}
                onChange={() => toggleReminder(opt.hours)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="field-input"
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" disabled={status === 'loading'} className="btn btn--primary">
          {status === 'loading' ? 'Signing up…' : 'Notify me'}
        </button>
      </div>
      {message && (
        <p
          role="status"
          className={`form-status ${status === 'error' ? 'form-status--error' : 'form-status--ok'}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'ok' | 'error';

// Keep in sync with Category / CATEGORY_LABEL in src/lib/entry-deadlines.ts.
const CATEGORY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'atp', label: 'ATP Tour (250 / 500 / 1000)' },
  { key: 'challenger', label: 'ATP Challenger Tour' },
  { key: 'itf', label: 'ITF World Tennis Tour' },
  { key: 'grandslam', label: 'Grand Slam' },
];

export default function ManagePreferences({
  token,
  email,
  initialCategories,
}: {
  token: string;
  email: string;
  initialCategories: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialCategories));
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0) {
      setStatus('error');
      setMessage('Pick at least one category, or use the unsubscribe link to stop all alerts.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, categories: Array.from(selected) }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        setStatus('ok');
        setMessage(data.message ?? 'Saved.');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Could not save. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
        Alerts for <strong>{email}</strong>
      </p>
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
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={status === 'loading'} className="btn btn--primary">
          {status === 'loading' ? 'Saving…' : 'Save preferences'}
        </button>
        <a
          href={`/api/unsubscribe?token=${encodeURIComponent(token)}`}
          style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          Unsubscribe from all
        </a>
      </div>
      {message && (
        <p
          role="status"
          className={`form-status ${status === 'error' ? 'form-status--error' : 'form-status--ok'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

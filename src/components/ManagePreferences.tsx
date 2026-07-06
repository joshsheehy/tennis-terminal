'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'ok' | 'error';

// Keep in sync with Category / CATEGORY_LABEL in src/lib/entry-deadlines.ts.
const CATEGORY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'grandslam', label: 'Grand Slam' },
  { key: 'atp', label: 'ATP Tour (250 / 500 / 1000)' },
  { key: 'challenger', label: 'ATP Challenger Tour' },
  { key: 'itf', label: 'ITF World Tennis Tour' },
];

export default function ManagePreferences({
  token,
  email,
  initialCategories,
  initialIncludeDoubles,
}: {
  token: string;
  email: string;
  initialCategories: string[];
  initialIncludeDoubles: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialCategories));
  const [doubles, setDoubles] = useState(initialIncludeDoubles);
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
        body: JSON.stringify({ token, categories: Array.from(selected), doubles }),
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

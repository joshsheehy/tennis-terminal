'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'ok' | 'error';

// Keep in sync with Category / CATEGORY_LABEL in src/lib/entry-deadlines.ts.
const CATEGORY_OPTIONS: Array<{ key: string; label: string; defaultOn: boolean }> = [
  { key: 'atp', label: 'ATP Tour (250 / 500 / 1000)', defaultOn: true },
  { key: 'challenger', label: 'ATP Challenger Tour', defaultOn: true },
  { key: 'itf', label: 'ITF World Tennis Tour', defaultOn: false },
  { key: 'grandslam', label: 'Grand Slam', defaultOn: false },
];

export default function AlertSignup() {
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CATEGORY_OPTIONS.filter((c) => c.defaultOn).map((c) => c.key))
  );
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setStatus('error');
      setMessage('Pick at least one category.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, categories: Array.from(selected) }),
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
        <legend style={{ padding: 0, fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
          Which deadlines do you want?
        </legend>
        {CATEGORY_OPTIONS.map((opt) => (
          <label
            key={opt.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={selected.has(opt.key)}
              onChange={() => toggle(opt.key)}
              style={{ width: 16, height: 16, accentColor: '#3CB043' }}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          style={{
            flex: '1 1 220px',
            padding: '10px 12px',
            fontSize: 15,
            borderRadius: 8,
            border: '1px solid var(--border, #ccc)',
            background: 'var(--bg)',
            color: 'var(--text)',
          }}
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          style={{
            padding: '10px 18px',
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            cursor: status === 'loading' ? 'default' : 'pointer',
            background: '#3CB043',
            color: '#fff',
            opacity: status === 'loading' ? 0.7 : 1,
          }}
        >
          {status === 'loading' ? 'Signing up…' : 'Notify me'}
        </button>
      </div>
      {message && (
        <p
          role="status"
          style={{ margin: 0, fontSize: 14, color: status === 'error' ? '#c0392b' : '#3CB043' }}
        >
          {message}
        </p>
      )}
    </form>
  );
}

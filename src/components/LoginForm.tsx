'use client';

import { useState } from 'react';
import { accountApi } from '@/lib/account-client';

// Two steps on one screen: email, then the 6-digit code from the email.
// No passwords. `next` is already sanitized by the page (safeNextPath).
export default function LoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await accountApi('/api/auth/request-code', 'POST', { email });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep('code');
    setCode('');
    setNotice(`We sent a 6-digit code to ${email.trim()}.`);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await accountApi('/api/auth/verify', 'POST', { email, code });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // Full navigation so every server-rendered page picks up the new cookie.
    window.location.assign(next);
  }

  if (step === 'email') {
    return (
      <form onSubmit={requestCode} className="auth-form">
        <label htmlFor="login-email" className="auth-form__label">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="field-input"
        />
        <button type="submit" disabled={busy} className="btn btn--primary">
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
        {error && (
          <p role="alert" className="form-status form-status--error">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="auth-form">
      {notice && (
        <p role="status" className="form-status form-status--ok">
          {notice}
        </p>
      )}
      <label htmlFor="login-code" className="auth-form__label">
        Code
      </label>
      <input
        id="login-code"
        type="text"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="123456"
        className="field-input auth-form__code"
        autoFocus
      />
      <button type="submit" disabled={busy || code.length !== 6} className="btn btn--primary">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
      <p className="auth-form__alt">
        <button type="button" className="link-button" onClick={() => requestCode()} disabled={busy}>
          Send a new code
        </button>
        {' · '}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setStep('email');
            setError(null);
            setNotice(null);
          }}
        >
          Use a different email
        </button>
      </p>
    </form>
  );
}

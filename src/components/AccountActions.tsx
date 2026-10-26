'use client';

import { useState } from 'react';
import { accountApi } from '@/lib/account-client';

// Sign out, and permanently delete the account. Deletion asks once more inline
// (no browser confirm dialog) because it can't be undone.
export default function AccountActions() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    await accountApi('/api/auth/logout', 'POST', {});
    window.location.assign('/');
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    const result = await accountApi('/api/account', 'DELETE', {});
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    window.location.assign('/');
  }

  return (
    <div className="account-actions">
      <button type="button" className="btn" onClick={signOut} disabled={busy}>
        Sign out
      </button>
      {!confirming ? (
        <button type="button" className="link-button link-button--danger" onClick={() => setConfirming(true)} disabled={busy}>
          Delete account
        </button>
      ) : (
        <div className="account-actions__confirm" role="group" aria-label="Confirm account deletion">
          <p>This permanently deletes your account and saved tournaments. Email alerts are separate and stay on.</p>
          <div className="account-actions__row">
            <button type="button" className="btn btn--danger" onClick={deleteAccount} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
    </div>
  );
}

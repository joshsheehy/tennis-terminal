'use client';

import { useEffect, useState } from 'react';
import { accountApi, fetchMe, loginHref } from '@/lib/account-client';

// Saves one or more editions to the signed-in user's schedule. One edition
// (a tournament page) toggles save/unsave; several (a Builder schedule) saves
// them all, and shows as saved once every one of them is. Signed-out visitors
// are sent to /login and brought back here afterwards. `schedule` forces the
// save-them-all behavior even for one edition (the Builder's chain), and
// `className` lets a caller restyle it.
export default function SaveButton({
  editionIds,
  label = 'Save',
  savedLabel = 'Saved',
  schedule = false,
  className = 'sched-btn',
}: {
  editionIds: string[];
  label?: string;
  savedLabel?: string;
  schedule?: boolean;
  className?: string;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = editionIds.length === 1 && !schedule;
  const key = editionIds.join(',');

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setSignedIn(Boolean(me?.user));
      const have = new Set(me?.savedEditionIds ?? []);
      setSaved(key.split(',').every((id) => have.has(id)));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  async function toggle() {
    if (!signedIn) {
      window.location.assign(loginHref());
      return;
    }
    setBusy(true);
    setError(null);
    const removing = saved && single;
    const result = await accountApi<{ savedEditionIds: string[] }>('/api/saved', removing ? 'DELETE' : 'POST', {
      editionIds,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401) {
        window.location.assign(loginHref());
        return;
      }
      setError(result.error);
      return;
    }
    const have = new Set(result.savedEditionIds);
    setSaved(editionIds.every((id) => have.has(id)));
  }

  if (editionIds.length === 0) return null;

  // Already-saved schedules link to where they live rather than re-saving.
  if (saved && !single) {
    return (
      <a href="/account" className={`${className} ${className}--saved`}>
        {savedLabel}
      </a>
    );
  }

  return (
    <span className="save-btn-wrap">
      <button
        type="button"
        className={`${className}${saved ? ` ${className}--on` : ''}`}
        onClick={toggle}
        disabled={busy || signedIn === null}
        aria-pressed={single ? saved : undefined}
        title={saved ? 'Remove from My schedule' : 'Save to My schedule'}
      >
        {busy ? 'Saving…' : saved ? savedLabel : label}
      </button>
      {error && (
        <span role="alert" className="form-status form-status--error save-btn-wrap__error">
          {error}
        </span>
      )}
    </span>
  );
}

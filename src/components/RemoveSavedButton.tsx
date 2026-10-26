'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { accountApi } from '@/lib/account-client';

export default function RemoveSavedButton({ editionId, name }: { editionId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await accountApi('/api/saved', 'DELETE', { editionIds: [editionId] });
    if (result.ok) router.refresh();
    else setBusy(false);
  }

  return (
    <button type="button" className="sched-btn sched-btn--ghost" onClick={remove} disabled={busy} aria-label={`Remove ${name}`}>
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}

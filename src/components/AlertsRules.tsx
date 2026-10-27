'use client';

import { useEffect, useState } from 'react';

// "The deadlines we track" reference. Open on the website; in the iOS app it
// starts collapsed to one tappable row so the signup isn't buried under it.
export default function AlertsRules({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (document.documentElement.classList.contains('in-app')) setOpen(false);
  }, []);

  return (
    <details
      className="alerts-rules"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="alerts-rules__summary">The deadlines we track</summary>
      {children}
    </details>
  );
}

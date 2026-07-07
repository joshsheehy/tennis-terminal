'use client';

import { useState } from 'react';

// Shares the current schedule URL. The whole schedule lives in the ?build=
// query string, so the URL alone reproduces it for anyone — no login, no
// server state. Uses the native share sheet on mobile, clipboard elsewhere.
export default function ScheduleShareButton() {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'My Tennis Cuts schedule', url });
        return;
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (rare) — select-all fallback isn't worth the weight
    }
  }

  return (
    <button type="button" className="sched-btn" onClick={share} aria-label="Share this schedule">
      {copied ? '✓ Link copied' : '🔗 Share'}
    </button>
  );
}

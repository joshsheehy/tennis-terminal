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
        await nav.share({ title: 'My TennisCuts schedule', url });
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
    <button type="button" className="sched-btn sched-btn--share" onClick={share} aria-label="Share this schedule">
      {/* iOS-style share glyph: box with an arrow out of the top */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
        <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
      </svg>
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';

// The pill that turns a cut number into an answer: given the viewer's saved
// ranking, would they have made this draw? Reads the same localStorage keys
// the builder's welcome card writes (swings.rank.*), so entering a ranking
// anywhere personalizes everywhere. Renders nothing until a ranking exists.

export const RANK_KEYS = {
  singles: 'swings.rank.singles',
  doubles: 'swings.rank.doubles',
} as const;

export const RANK_EVENT = 'tc:rank-change';

export function readRank(event: 'singles' | 'doubles'): number | null {
  if (typeof window === 'undefined') return null;
  const v = Number(localStorage.getItem(RANK_KEYS[event]));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

export function writeRank(event: 'singles' | 'doubles', value: number | null): void {
  if (value && value > 0) localStorage.setItem(RANK_KEYS[event], String(Math.round(value)));
  else localStorage.removeItem(RANK_KEYS[event]);
  window.dispatchEvent(new Event(RANK_EVENT));
}

export function useMyRank(event: 'singles' | 'doubles'): number | null {
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => setRank(readRank(event));
    sync();
    window.addEventListener(RANK_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(RANK_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [event]);
  return rank;
}

// A ranking within this distance of the cut (absolute, or 5% of the cut for
// deep cuts) is a coin flip either way — call it the bubble instead of
// pretending to know.
export function verdictFor(
  rank: number,
  cut: number
): { state: 'in' | 'bubble' | 'out'; margin: number } {
  const margin = cut - rank; // positive = inside the cut
  const bubble = Math.max(10, Math.round(cut * 0.05));
  if (Math.abs(margin) <= bubble) return { state: 'bubble', margin };
  return { state: margin > 0 ? 'in' : 'out', margin };
}

export default function RankVerdict({
  cut,
  event,
}: {
  cut: number;
  event: 'singles' | 'doubles';
}) {
  const rank = useMyRank(event);
  if (rank == null || !Number.isFinite(cut) || cut <= 0) return null;
  const v = verdictFor(rank, cut);
  const label =
    v.state === 'in'
      ? `You're in by ${v.margin}`
      : v.state === 'out'
        ? `Out by ${Math.abs(v.margin)}`
        : 'On the bubble';
  return (
    <span className={`rank-verdict rank-verdict--${v.state}`} title={`Your ${event} rank vs this cut`}>
      {label}
    </span>
  );
}

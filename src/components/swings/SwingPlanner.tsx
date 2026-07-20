'use client';

import { useMemo, useState } from 'react';
import type { SwingsPageData, SwingMapEvent } from '@/lib/swings-page-data';
import { verdictFor } from '@/components/RankVerdict';

// The "where can I actually play?" layer of the builder: a season heat-strip
// (one cell per week, colored by the best verdict your rank gets that week)
// and a one-tap swing planner that proposes a consecutive run of tournaments
// you'd get into, instead of leaving you to click blank weeks hunting.

type WeekPick = {
  week: number;
  event: SwingMapEvent;
  cut: number;
  projected: boolean;
  state: 'in' | 'bubble' | 'out';
  margin: number;
};

function cutFor(data: SwingsPageData, slug: string): { cut: number; projected: boolean } | null {
  const proj = data.cutProjections[slug]?.m;
  if (proj) return { cut: proj.cut, projected: true };
  const ref = data.cutRefs[slug]?.singles;
  const cut = ref?.mainAlt ?? ref?.mainCut;
  return cut != null && cut > 0 ? { cut, projected: false } : null;
}

const LEVEL_PREF = ['1000', '500', '250', '175', '125', '100', '75', '50'];
function levelScore(level: string): number {
  const i = LEVEL_PREF.findIndex((t) => level.includes(t));
  return i === -1 ? LEVEL_PREF.length : i;
}

/** Best playable event per week at this rank: prefer IN at the highest level
 * (then biggest margin), then bubble, then the nearest miss. */
function bestPerWeek(data: SwingsPageData, rank: number): Map<number, WeekPick> {
  const byWeek = new Map<number, WeekPick>();
  for (const e of data.events) {
    const c = cutFor(data, e.slug);
    if (!c) continue;
    const v = verdictFor(rank, c.cut);
    const pick: WeekPick = { week: e.week, event: e, cut: c.cut, projected: c.projected, state: v.state, margin: v.margin };
    const cur = byWeek.get(e.week);
    if (!cur) { byWeek.set(e.week, pick); continue; }
    const better =
      rankState(pick.state) !== rankState(cur.state)
        ? rankState(pick.state) < rankState(cur.state)
        : pick.state === 'in'
          ? levelScore(pick.event.level) !== levelScore(cur.event.level)
            ? levelScore(pick.event.level) < levelScore(cur.event.level)
            : pick.margin > cur.margin
          : Math.abs(pick.margin) < Math.abs(cur.margin);
    if (better) byWeek.set(e.week, pick);
  }
  return byWeek;
}
function rankState(s: 'in' | 'bubble' | 'out'): number {
  return s === 'in' ? 0 : s === 'bubble' ? 1 : 2;
}

/** Best consecutive window of `len` weeks from `fromWeek` on: maximize weeks
 * you'd make (IN 3pts, bubble 1pt), tie-break to the earliest start. */
function planSwing(picks: Map<number, WeekPick>, fromWeek: number, len: number): WeekPick[] {
  const weeks = [...picks.keys()].sort((a, b) => a - b);
  const maxWeek = weeks.length ? weeks[weeks.length - 1] : 0;
  let best: { score: number; chain: WeekPick[] } | null = null;
  for (let start = fromWeek; start + len - 1 <= maxWeek; start++) {
    const chain: WeekPick[] = [];
    let score = 0;
    for (let w = start; w < start + len; w++) {
      const p = picks.get(w);
      if (!p || p.state === 'out') continue;
      chain.push(p);
      score += p.state === 'in' ? 3 : 1;
    }
    if (chain.length < Math.min(2, len)) continue;
    if (!best || score > best.score) best = { score, chain };
  }
  return best?.chain ?? [];
}

export default function SwingPlanner({
  data,
  rank,
  selectedWeek,
  onSelectWeek,
  onApplyPlan,
}: {
  data: SwingsPageData;
  rank: number | null;
  selectedWeek: number;
  onSelectWeek: (week: number) => void;
  onApplyPlan: (editionIds: string[], firstWeek: number) => void;
}) {
  const [len, setLen] = useState(4);
  const [proposed, setProposed] = useState<WeekPick[] | null>(null);

  const picks = useMemo(() => (rank != null ? bestPerWeek(data, rank) : null), [data, rank]);
  const maxWeek = useMemo(
    () => Math.max(0, ...data.events.map((e) => e.week)),
    [data.events]
  );

  if (rank == null) {
    return (
      <div className="planner planner--empty">
        Enter your singles rank above and this strip shows, week by week, where you&apos;d get in.
      </div>
    );
  }
  if (!picks) return null;
  if (picks.size === 0) {
    return (
      <div className="planner planner--empty">
        No cuts or projections for these filters yet — the strip lights up as they land.
      </div>
    );
  }

  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  function propose() {
    const chain = planSwing(picks!, Math.max(1, data.currentWeek), len);
    setProposed(chain);
  }

  return (
    <div className="planner">
      <div className="planner__strip" role="listbox" aria-label="Season at your rank">
        {weeks.map((w) => {
          const p = picks.get(w);
          const cls = p ? `planner__cell--${p.state}` : 'planner__cell--none';
          const label = p
            ? `Week ${w}: ${p.event.name} — ${p.state === 'in' ? `in by ${p.margin}` : p.state === 'bubble' ? 'bubble' : `out by ${Math.abs(p.margin)}`}${p.projected ? ' (projected)' : ''}`
            : `Week ${w}: no cut data`;
          return (
            <button
              key={w}
              type="button"
              className={`planner__cell ${cls}${w === selectedWeek ? ' planner__cell--sel' : ''}`}
              title={label}
              aria-label={label}
              onClick={() => onSelectWeek(w)}
            />
          );
        })}
      </div>
      <div className="planner__bar">
        <span className="planner__legend">
          <i className="planner__dot planner__dot--in" /> in
          <i className="planner__dot planner__dot--bubble" /> bubble
          <i className="planner__dot planner__dot--out" /> out
        </span>
        <label className="planner__len">
          Plan
          <select value={len} onChange={(e) => setLen(Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} weeks</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--primary planner__go" onClick={propose}>
          Plan my swing
        </button>
      </div>
      {proposed && (
        <div className="planner__proposal">
          {proposed.length === 0 ? (
            <p>No playable run found from this week at your rank — try fewer weeks or widen the level filters.</p>
          ) : (
            <>
              <p className="planner__proposal-title">
                {proposed.length} tournaments, {proposed.filter((p) => p.state === 'in').length} you&apos;d make:
              </p>
              <ul>
                {proposed.map((p) => (
                  <li key={p.event.editionId}>
                    <strong>Wk {p.week}</strong> {p.event.name}
                    <span className={`rank-verdict rank-verdict--${p.state}`}>
                      {p.state === 'in' ? `in by ${p.margin}` : p.state === 'bubble' ? 'bubble' : 'out'}
                    </span>
                    {p.projected && <em className="planner__proj">proj.</em>}
                  </li>
                ))}
              </ul>
              <div className="planner__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    onApplyPlan(proposed.map((p) => p.event.editionId), proposed[0].week);
                    setProposed(null);
                  }}
                >
                  Add all to my schedule
                </button>
                <button type="button" className="btn" onClick={() => setProposed(null)}>
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

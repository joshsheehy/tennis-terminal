'use client';

import { useMemo, useState } from 'react';
import type { SwingsPageData, SwingMapEvent } from '@/lib/swings-page-data';
import { verdictFor, verdictLabel } from '@/components/RankVerdict';

// "Plan my swing": propose consecutive-week runs of tournaments that stay in
// ONE region — the way players actually tour (the South American clay swing,
// the European summer, the US hard-court run) — filtered to events the
// viewer's rank gets into. Each proposal shows the hop distances and total
// travel, so "same part of the world" is a number, not a guess.

type Stop = {
  week: number;
  event: SwingMapEvent;
  cut: number;
  projected: boolean;
  state: 'in' | 'bubble' | 'out';
  margin: number;
  /** km from the previous stop (0 for the first). */
  hopKm: number;
};

export type SwingProposal = {
  stops: Stop[];
  totalKm: number;
  countries: string[];
  inCount: number;
};

function cutFor(data: SwingsPageData, slug: string): { cut: number; projected: boolean } | null {
  const proj = data.cutProjections[slug]?.m;
  if (proj) return { cut: proj.cut, projected: true };
  const ref = data.cutRefs[slug]?.singles;
  const cut = ref?.mainAlt ?? ref?.mainCut;
  return cut != null && cut > 0 ? { cut, projected: false } : null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A hop between consecutive stops longer than this is not "the same swing".
const MAX_HOP_KM = 3000;
// Entry value of a stop (events the rank is clearly out of are skipped).
const IN_PTS = 3;
const BUBBLE_PTS = 1;
// Score penalty per km of travel — tuned so ~1500 km costs about one
// bubble-stop of value: tight regional runs beat scattered "better" events.
const KM_PENALTY = 1 / 1500;

/** Playable candidates per week at this rank (in or bubble only). */
function candidatesPerWeek(data: SwingsPageData, rank: number): Map<number, Stop[]> {
  const byWeek = new Map<number, Stop[]>();
  for (const e of data.events) {
    if (e.latitude == null || e.longitude == null) continue;
    const c = cutFor(data, e.slug);
    if (!c) continue;
    const v = verdictFor(rank, c.cut);
    if (v.state === 'out') continue;
    const stop: Stop = { week: e.week, event: e, cut: c.cut, projected: c.projected, state: v.state, margin: v.margin, hopKm: 0 };
    const list = byWeek.get(e.week);
    if (list) list.push(stop);
    else byWeek.set(e.week, [stop]);
  }
  return byWeek;
}

/** Greedy region-aware chains: from each playable event in the start week,
 * extend week by week to the best nearby playable event (hops over
 * MAX_HOP_KM never join a swing), scoring entry value minus travel.
 * Returns the top proposals from distinct start weeks. */
export function planRegionalSwings(
  data: SwingsPageData,
  rank: number,
  fromWeek: number,
  len: number
): SwingProposal[] {
  const byWeek = candidatesPerWeek(data, rank);
  const maxWeek = Math.max(0, ...byWeek.keys());
  const scored: Array<SwingProposal & { score: number }> = [];

  for (let start = fromWeek; start + len - 1 <= maxWeek; start++) {
    for (const seed of byWeek.get(start) ?? []) {
      const stops: Stop[] = [{ ...seed, hopKm: 0 }];
      let score = seed.state === 'in' ? IN_PTS : BUBBLE_PTS;
      let prev = seed.event;
      for (let w = start + 1; w < start + len; w++) {
        let best: { stop: Stop; value: number } | null = null;
        for (const cand of byWeek.get(w) ?? []) {
          const km = haversineKm(prev.latitude, prev.longitude, cand.event.latitude, cand.event.longitude);
          if (km > MAX_HOP_KM) continue;
          const value = (cand.state === 'in' ? IN_PTS : BUBBLE_PTS) - km * KM_PENALTY;
          if (!best || value > best.value) best = { stop: { ...cand, hopKm: Math.round(km) }, value };
        }
        if (!best) continue; // gap week: rest, stay in region
        stops.push(best.stop);
        score += best.value;
        prev = best.stop.event;
      }
      if (stops.length < 2) continue;
      const totalKm = stops.reduce((a, s) => a + s.hopKm, 0);
      const countries = [...new Set(stops.map((s) => s.event.country).filter((c): c is string => !!c))];
      scored.push({
        stops,
        totalKm,
        countries,
        inCount: stops.filter((s) => s.state === 'in').length,
        score,
      });
    }
  }

  // Best proposal per start week, then top 3 overall — three genuinely
  // different swings to choose from, not three variants of one.
  const bestByStart = new Map<number, (typeof scored)[number]>();
  for (const p of scored) {
    const k = p.stops[0].week;
    const cur = bestByStart.get(k);
    if (!cur || p.score > cur.score) bestByStart.set(k, p);
  }
  return [...bestByStart.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score: _score, ...p }) => p);
}

export default function SwingPlanner({
  data,
  rank,
  onApplyPlan,
}: {
  data: SwingsPageData;
  rank: number | null;
  onApplyPlan: (editionIds: string[], firstWeek: number) => void;
}) {
  const [len, setLen] = useState(4);
  const [proposals, setProposals] = useState<SwingProposal[] | null>(null);

  const hasData = useMemo(
    () => data.events.some((e) => cutFor(data, e.slug) != null),
    [data]
  );

  if (rank == null) {
    return (
      <div className="planner planner--empty">
        Enter your ranking above, then let the planner propose a regional swing —
        consecutive weeks, same part of the world, events you&apos;d get into.
      </div>
    );
  }
  if (!hasData) {
    return (
      <div className="planner planner--empty">
        No cuts or projections for these filters yet — the planner needs at least one.
      </div>
    );
  }

  return (
    <div className="planner">
      <div className="planner__bar">
        <span className="planner__legend">
          Find consecutive weeks in one region at your rank
        </span>
        <label className="planner__len">
          <select value={len} onChange={(e) => setLen(Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} weeks</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--primary planner__go"
          onClick={() => setProposals(planRegionalSwings(data, rank, Math.max(1, data.currentWeek), len))}
        >
          Plan my swing
        </button>
      </div>
      {proposals && (
        <div className="planner__proposals">
          {proposals.length === 0 ? (
            <div className="planner__proposal">
              <p>
                No regional run found from this week at your rank — try fewer weeks or
                turn on more levels above.
              </p>
            </div>
          ) : (
            proposals.map((p, i) => (
              <div key={i} className="planner__proposal">
                <p className="planner__proposal-title">
                  {p.stops.length} weeks · {p.countries.join(' / ') || 'one region'} ·{' '}
                  {p.totalKm.toLocaleString()} km total travel · {p.inCount} you&apos;d make
                </p>
                <ul>
                  {p.stops.map((s) => (
                    <li key={s.event.editionId}>
                      <strong>Wk {s.week}</strong>
                      {s.hopKm > 0 && <span className="planner__hop">→ {s.hopKm.toLocaleString()} km</span>}
                      {' '}{s.event.name}
                      <span className="planner__where">{s.event.city}</span>
                      <span className={`rank-verdict rank-verdict--${s.state}`}>{verdictLabel(s)}</span>
                      {s.projected && <em className="planner__proj">proj.</em>}
                    </li>
                  ))}
                </ul>
                <div className="planner__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      onApplyPlan(p.stops.map((s) => s.event.editionId), p.stops[0].week);
                      setProposals(null);
                    }}
                  >
                    Use this swing
                  </button>
                </div>
              </div>
            ))
          )}
          <button type="button" className="btn planner__dismiss" onClick={() => setProposals(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

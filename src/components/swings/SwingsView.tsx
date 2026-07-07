'use client';

import { AVAILABLE_SEASONS } from '@/lib/seasons';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SwingsPageData, SwingMapEvent, CutSeriesByDraw, CutProjectionsByDraw } from '@/lib/swings-page-data';
import { LevelGroup, levelRank } from '@/lib/swings';
import {
  CandidateTier,
  RankedCandidate,
  TIER_LABELS,
  TIER_ORDER,
  buildCandidates,
  summarizeChain,
} from '@/lib/swing-builder';
import {
  EntryStatus,
  STATUS_META,
  describeEntrySummary,
  entryStatus,
  summarizeEntries,
} from '@/lib/swing-rank-check';
import type { MapEvent } from './SwingsMap';
// Owned here so both the Builder (/) and Swings (/swings) routes get the styles.
import '../../app/swings/swings.css';

const SwingsMap = dynamic(() => import('./SwingsMap'), {
  ssr: false,
  loading: () => <div className="swings-map swings-map--loading">Loading map…</div>,
});

const LOOKAHEAD = 3;
const MAX_WEEK = 52;
// Selectable surfaces. "Indoor Hard" is folded into "Hard" (see surfaceOk).
const SURFACES = ['Clay', 'Hard', 'Grass'];
const SEASONS = AVAILABLE_SEASONS;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUP_LABELS: Record<LevelGroup, string> = { atp: 'ATP', challenger: 'Challenger', itf: 'ITF' };

// Non-metric regions (US + the two other non-metric countries). Detected from
// the browser locale so US visitors see miles instead of kilometres.
function detectImperial(): boolean {
  if (typeof navigator === 'undefined') return false;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => {
    try {
      const region = new Intl.Locale(l).maximize().region;
      return region === 'US' || region === 'LR' || region === 'MM';
    } catch {
      return /-(US|LR|MM)\b/i.test(l);
    }
  });
}

function formatDistance(km: number, imperial: boolean): string {
  return imperial ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
}

// Grand Slam qualifying weeks are singles-only — no doubles draw, so the builder
// hides the doubles entry pill for them.
function isSinglesOnly(level: string): boolean {
  return level.toLowerCase().includes('qualifying');
}

type SheetState = 'collapsed' | 'half' | 'full';
type Mode = 'explore' | 'build';

function thisWeekSummary(items: SwingsPageData['swings']): string {
  const swings = items.filter((s) => s.kind === 'swing').length;
  const series = items.filter((s) => s.kind === 'series').length;
  const parts: string[] = [];
  if (swings) parts.push(`${swings} swing${swings > 1 ? 's' : ''}`);
  if (series) parts.push(`${series} series`);
  return parts.length ? `${parts.join(' · ')} this week` : 'Nothing this week';
}

// Monday (UTC) of an ATP week, mirroring getAtpSeasonStartDateUtc.
function weekStart(year: number, week: number): Date {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const isoDow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const offset = isoDow <= 3 ? 1 - isoDow : 8 - isoDow;
  return new Date(jan1.getTime() + (offset + (week - 1) * 7) * 86400000);
}

// Short start-date label for a week, e.g. "Jun 29".
function weekDateLabel(year: number, week: number): string {
  const d = weekStart(year, week);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Date range across weeks, e.g. "Jun 22 – Jun 29" (or a single date if equal).
function weekRangeLabel(year: number, a: number, b: number): string {
  return a === b ? weekDateLabel(year, a) : `${weekDateLabel(year, a)} – ${weekDateLabel(year, b)}`;
}

// Drag-to-resize for the mobile bottom sheet. A pointer drag on the grip moves
// the sheet height live, then snaps to the nearest of collapsed/half/full on
// release; a tap (no real movement) steps it open one notch. No-ops on desktop,
// where the sheet is a fixed side rail.
function useSheetDrag(state: SheetState, setState: (s: SheetState) => void) {
  const [dragPx, setDragPx] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);
  const moved = useRef(false);

  const toggle = () =>
    setState(state === 'full' ? 'half' : state === 'collapsed' ? 'half' : 'full');

  const snapTargets = (): Array<[SheetState, number]> => {
    const vh = window.innerHeight;
    return [
      ['collapsed', 84],
      ['half', vh * 0.46],
      ['full', vh * 0.88],
    ];
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (window.innerWidth >= 900) return; // side rail on desktop
    const sheet = (e.currentTarget as HTMLElement).closest('.sheet') as HTMLElement | null;
    start.current = { y: e.clientY, h: sheet ? sheet.getBoundingClientRect().height : 84 };
    moved.current = false;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already gone; ignore.
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dy = start.current.y - e.clientY; // up = positive = taller
    if (!moved.current && Math.abs(dy) < 5) return; // ignore micro-jitter
    moved.current = true;
    const vh = window.innerHeight;
    setDragPx(Math.max(72, Math.min(vh * 0.92, start.current.h + dy)));
  };

  const onPointerUp = () => {
    if (!start.current) return;
    if (moved.current && dragPx != null) {
      let best = snapTargets()[0];
      for (const t of snapTargets()) {
        if (Math.abs(t[1] - dragPx) < Math.abs(best[1] - dragPx)) best = t;
      }
      setState(best[0]);
    } else {
      toggle(); // it was a tap, not a drag
    }
    start.current = null;
    setDragPx(null);
  };

  const gripHandlers = { onPointerDown, onPointerMove, onPointerUp };
  const sheetStyle: CSSProperties = dragPx != null ? { height: dragPx, transition: 'none' } : {};
  return { gripHandlers, sheetStyle, toggle };
}

export default function SwingsView({
  data,
  defaultMode = 'explore',
}: {
  data: SwingsPageData;
  /** Initial mode when no ?build= param is present. Builder route passes 'build'. */
  defaultMode?: Mode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const eventById = useMemo(() => {
    const m = new Map<string, SwingMapEvent>();
    for (const e of data.events) m.set(e.editionId, e);
    return m;
  }, [data.events]);

  // Mode is driven by the route (Builder = / , Swings = /swings) via the
  // global nav; a shared ?build= link also opens in build. No in-page toggle.
  const mode: Mode = params.get('build') ? 'build' : defaultMode;
  // The schedule being built survives every navigation: the URL ?build= param
  // is the shareable source of truth, with a per-year sessionStorage mirror so
  // hitting Back (or the nav's bare "/" link) never wipes the user's work.
  const [chainIds, setChainIds] = useState<string[]>(() => {
    const fromUrl = (params.get('build')?.split(',') ?? []).filter((id) => id.length > 0);
    if (fromUrl.length) return fromUrl;
    try {
      const saved = sessionStorage.getItem(`swings.chain:${data.year}`);
      if (saved) return JSON.parse(saved).filter((id: unknown) => typeof id === 'string');
    } catch {
      // storage blocked/malformed — start empty
    }
    return [];
  });
  const [selectedWeek, setSelectedWeek] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(`swings.week:${data.year}`));
      if (Number.isInteger(saved) && saved >= 1 && saved <= MAX_WEEK) return saved;
    } catch {
      // fall through to current week
    }
    return Math.min(MAX_WEEK, Math.max(1, data.currentWeek));
  });
  const [selectedSwing, setSelectedSwing] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>(mode === 'build' ? 'half' : 'collapsed');
  const [fitNonce, setFitNonce] = useState(1);
  const [rankSingles, setRankSingles] = useState<number | null>(null);
  const [rankDoubles, setRankDoubles] = useState<number | null>(null);
  const [imperial, setImperial] = useState(false);
  useEffect(() => setImperial(detectImperial()), []);

  // Tournament info popover (ⓘ dot on builder rows): mini cut line + link to
  // the full tournament page.
  // Tournament info popover. canAdd marks popovers opened from a candidate
  // row: tapping a row no longer adds instantly (too easy to trigger by
  // accident) — it opens this card with an explicit "Add to schedule" button.
  const [infoEvent, setInfoEvent] = useState<{ event: SwingMapEvent; canAdd: boolean } | null>(null);

  // First-visit welcome card (build mode only). Shown once, then remembered;
  // returning users — anyone with a stored rank or a chain in the URL — never
  // see it.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (mode !== 'build') return;
    try {
      if (localStorage.getItem('swings.welcomed')) return;
      if (localStorage.getItem('swings.rank.singles') || chainIds.length > 0) {
        localStorage.setItem('swings.welcomed', '1');
        return;
      }
      setShowWelcome(true);
    } catch {
      // storage blocked (private mode) — skip the card rather than nag forever
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dismissWelcome = useCallback(() => {
    try {
      localStorage.setItem('swings.welcomed', '1');
    } catch {
      // ignore
    }
    setShowWelcome(false);
  }, []);

  // Remember both rankings between visits.
  useEffect(() => {
    const s = Number(localStorage.getItem('swings.rank.singles'));
    if (Number.isFinite(s) && s > 0) setRankSingles(s);
    const d = Number(localStorage.getItem('swings.rank.doubles'));
    if (Number.isFinite(d) && d > 0) setRankDoubles(d);
  }, []);
  const makeRankUpdater = (key: string, set: (v: number | null) => void) => (value: number | null) => {
    set(value);
    if (value && value > 0) localStorage.setItem(key, String(value));
    else localStorage.removeItem(key);
  };
  const updateRankSingles = makeRankUpdater('swings.rank.singles', setRankSingles);
  const updateRankDoubles = makeRankUpdater('swings.rank.doubles', setRankDoubles);

  const surfaces = useMemo(() => {
    const raw = params.get('surface');
    return raw ? new Set(raw.split(',').filter((s) => SURFACES.includes(s))) : null;
  }, [params]);

  const surfaceOk = useCallback(
    (surface: string) => {
      if (!surfaces || surfaces.size === 0) return true;
      // Indoor Hard is folded into the "Hard" pill.
      return surfaces.has(surface === 'Indoor Hard' ? 'Hard' : surface);
    },
    [surfaces]
  );

  useEffect(() => setFitNonce((n) => n + 1), [selectedWeek, selectedSwing, mode, chainIds.length]);

  // One-line reference-cut summary for map popups ("2025 cut · MD #245 · Q #390").
  const cutTextFor = useCallback(
    (slug: string): string | undefined => {
      const ref = data.cutRefs[slug]?.singles;
      if (!ref?.fromYear) return undefined;
      const md = ref.mainAlt ?? ref.mainCut;
      const parts: string[] = [];
      if (md != null) parts.push(`MD #${md}`);
      if (ref.qualCut != null) parts.push(`Q #${ref.qualCut}`);
      return parts.length ? `${ref.fromYear} cut · ${parts.join(' · ')}` : undefined;
    },
    [data.cutRefs]
  );

  // Tournaments per week under the current surface filter — drives the
  // timeline's density bars so the shape of the season is visible at a glance.
  const weekCounts = useMemo(() => {
    const counts = new Array<number>(MAX_WEEK + 1).fill(0);
    for (const e of data.events) {
      if (e.week >= 1 && e.week <= MAX_WEEK && surfaceOk(e.surface)) counts[e.week]++;
    }
    return counts;
  }, [data.events, surfaceOk]);

  // Nearest week at/after (or at/before) `from` that has matching events —
  // the builder navigates between these so users never dead-end on an empty
  // week with no obvious way forward.
  const nextEventWeek = useCallback(
    (from: number): number | null => {
      for (let w = Math.max(1, from); w <= MAX_WEEK; w++) if (weekCounts[w] > 0) return w;
      return null;
    },
    [weekCounts]
  );
  const prevEventWeek = useCallback(
    (from: number): number | null => {
      for (let w = Math.min(MAX_WEEK, from); w >= 1; w--) if (weekCounts[w] > 0) return w;
      return null;
    },
    [weekCounts]
  );

  // --- shared helpers -------------------------------------------------------
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mut(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  // Keep the ?build= param in sync without a server round-trip, and mirror it
  // per year so back-navigation and bare nav links can't lose the schedule.
  const syncBuildParam = (ids: string[]) => {
    const next = new URLSearchParams(params.toString());
    if (ids.length) next.set('build', ids.join(','));
    else next.delete('build');
    window.history.replaceState(null, '', `${pathname}?${next.toString()}`);
    try {
      if (ids.length) sessionStorage.setItem(`swings.chain:${data.year}`, JSON.stringify(ids));
      else sessionStorage.removeItem(`swings.chain:${data.year}`);
    } catch {
      // persistence is a nice-to-have
    }
  };

  // Back/forward moves to history entries whose ?build= snapshot may be older
  // than the schedule the user just built. Never let a navigation destroy
  // work: adopt the param only when it carries MORE state; otherwise re-stamp
  // the current chain onto the entry we landed on.
  const chainRef = useRef(chainIds);
  chainRef.current = chainIds;
  useEffect(() => {
    const fromUrl = (params.get('build')?.split(',') ?? []).filter((id) => id.length > 0);
    const current = chainRef.current;
    if (fromUrl.join(',') === current.join(',')) return;
    if (fromUrl.length > current.length) setChainIds(fromUrl);
    else if (current.length) syncBuildParam(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Remember which week the builder is on (per year) so returning from a
  // tournament page reopens the same week, not "today".
  useEffect(() => {
    try {
      sessionStorage.setItem(`swings.week:${data.year}`, String(selectedWeek));
    } catch {
      // ignore
    }
  }, [selectedWeek, data.year]);

  const inWindow = (week: number) => week >= selectedWeek && week <= selectedWeek + LOOKAHEAD;

  // ============================ BUILD MODE =================================
  const chain = useMemo(
    () => chainIds.map((id) => eventById.get(id)).filter((e): e is SwingMapEvent => !!e),
    [chainIds, eventById]
  );
  const anchor = chain[chain.length - 1] ?? null;

  // The builder offers exactly one week at a time — `selectedWeek` is the week
  // currently being chosen. Candidates are all that week's events (current
  // filters), ranked relative to the last stop (same country first).
  const candidates: RankedCandidate<SwingMapEvent>[] = useMemo(() => {
    if (mode !== 'build') return [];
    if (anchor) {
      return buildCandidates(data.events, anchor, { week: selectedWeek, excludeEditionIds: chainIds })
        .filter((c) => surfaceOk(c.event.surface));
    }
    // No anchor yet: the selected week's events are the start options,
    // highest level first (then by name) so the biggest events lead.
    return data.events
      .filter((e) => e.week === selectedWeek && surfaceOk(e.surface))
      .sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.name.localeCompare(b.name))
      .map((event) => ({ event, tier: 'same-region' as CandidateTier, distanceKm: null, weekGap: 0, sameSurface: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchor, data.events, chainIds, selectedWeek, surfaces]);

  const addStop = (editionId: string) => {
    if (chainIds.includes(editionId)) return;
    const ev = eventById.get(editionId);
    if (!ev) return;
    const next = [...chainIds, editionId];
    setChainIds(next);
    // Advance straight to the next week that has events (skipping empty
    // weeks), so the user is never dropped onto a dead week.
    setSelectedWeek(nextEventWeek(ev.week + 1) ?? Math.min(MAX_WEEK, ev.week + 1));
    syncBuildParam(next);
  };
  const removeStop = (index: number) => {
    const next = chainIds.filter((_, i) => i !== index);
    setChainIds(next);
    const last = next.length ? eventById.get(next[next.length - 1]) : null;
    if (last) setSelectedWeek(Math.min(MAX_WEEK, Math.max(1, last.week)));
    syncBuildParam(next);
  };
  const clearChain = () => {
    setChainIds([]);
    syncBuildParam([]);
  };
  // ============================ EXPLORE MODE ==============================
  const exploreEvents: MapEvent[] = useMemo(() => {
    const selectedEditionIds =
      selectedSwing != null ? new Set(data.swings[selectedSwing].editionIds) : null;
    return data.events
      .filter((e) => {
        if (!surfaceOk(e.surface)) return false;
        if (selectedEditionIds?.has(e.editionId)) return true;
        return inWindow(e.week);
      })
      .map((e) => ({
        ...e,
        dim: selectedEditionIds?.has(e.editionId) ? false : e.week !== selectedWeek,
        cutText: cutTextFor(e.slug),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedWeek, selectedSwing, surfaces, cutTextFor]);

  const visibleSwingIndexes = useMemo(() => {
    if (mode === 'build') return [];
    const set = new Set<number>();
    for (const s of data.swings) {
      if (!s.surfaces.some(surfaceOk)) continue;
      if (s.startWeek <= selectedWeek + LOOKAHEAD && s.endWeek >= selectedWeek) set.add(s.index);
    }
    if (selectedSwing != null) set.add(selectedSwing);
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedWeek, selectedSwing, surfaces, mode]);

  const swingsThisWeek = useMemo(
    () =>
      data.swings.filter(
        (s) => s.startWeek <= selectedWeek && s.endWeek >= selectedWeek && s.surfaces.some(surfaceOk)
      ),
    [data, selectedWeek, surfaceOk]
  );

  const nearestUpcoming = useMemo(() => {
    const upcoming = data.swings
      .filter((s) => s.startWeek > selectedWeek && s.surfaces.some(surfaceOk))
      .sort((a, b) => a.startWeek - b.startWeek);
    return upcoming[0] ?? null;
  }, [data, selectedWeek, surfaceOk]);

  // --- what the map renders -------------------------------------------------
  // Per-stop entry status against each tournament's most recent historical cut.
  const singlesStatuses: EntryStatus[] = useMemo(
    () => chain.map((e) => entryStatus(rankSingles, data.cutRefs[e.slug]?.singles)),
    [chain, rankSingles, data.cutRefs]
  );
  const doublesStatuses: EntryStatus[] = useMemo(
    () => chain.map((e) => entryStatus(rankDoubles, data.cutRefs[e.slug]?.doubles)),
    [chain, rankDoubles, data.cutRefs]
  );
  const singlesSummary = useMemo(() => summarizeEntries(singlesStatuses), [singlesStatuses]);
  const doublesSummary = useMemo(() => summarizeEntries(doublesStatuses), [doublesStatuses]);

  const builderMapEvents: MapEvent[] = useMemo(() => {
    if (mode !== 'build') return [];
    const chainEvents: MapEvent[] = chain.map((e, i) => ({
      ...e,
      dim: false,
      builderRole: 'chain',
      chainPos: i + 1,
      cutText: cutTextFor(e.slug),
      // Tint the chain dot by entry status — singles if entered, else doubles.
      statusColor:
        rankSingles != null
          ? STATUS_META[singlesStatuses[i]].color
          : rankDoubles != null
            ? STATUS_META[doublesStatuses[i]].color
            : undefined,
    }));
    const candEvents: MapEvent[] = candidates
      .filter((c) => c.event.latitude != null && c.event.longitude != null)
      .map((c) => ({
        ...c.event,
        dim: false,
        builderRole: 'candidate' as const,
        tier: c.tier,
        cutText: cutTextFor(c.event.slug),
      }));
    return [...chainEvents, ...candEvents];
  }, [mode, chain, candidates, rankSingles, rankDoubles, singlesStatuses, doublesStatuses, cutTextFor]);

  const fitPoints: [number, number][] = useMemo(() => {
    if (mode === 'build') {
      const src = chain.length ? chain : candidates.map((c) => c.event);
      return src.map((e) => [e.latitude!, e.longitude!] as [number, number]).filter((p) => p[0] != null);
    }
    if (selectedSwing != null) {
      const p = data.swings[selectedSwing].path;
      if (p.length) return p.map((q) => [q.lat, q.lng]);
    }
    const wk = exploreEvents.filter((e) => e.week === selectedWeek);
    return (wk.length ? wk : exploreEvents).map((e) => [e.latitude, e.longitude] as [number, number]);
  }, [mode, chain, candidates, data, selectedSwing, exploreEvents, selectedWeek]);

  const initialCenter: [number, number] = fitPoints[0] ?? [25, 5];

  const selectSwing = (index: number | null) => {
    setSelectedSwing(index);
    if (index != null) {
      setSheet('half');
      setSelectedWeek(Math.min(MAX_WEEK, Math.max(1, data.swings[index].startWeek)));
    }
  };

  const activeSwing = selectedSwing != null ? data.swings[selectedSwing] : null;
  const chainSummary = summarizeChain(chain);

  // Weeks that hold one of your stops — marked with a ring in the timeline so
  // the itinerary is visible in the season overview.
  const chainWeeks = useMemo(() => new Set(chain.map((e) => e.week)), [chain]);

  // The scheduling frontier: your latest stop's week, and the first week with
  // events after it. When the user wanders behind the frontier (reviewing
  // earlier weeks), "resume scheduling" jumps them straight back here.
  const lastStopWeek = chain.length ? Math.max(...chain.map((e) => e.week)) : null;
  const resumeWeek = lastStopWeek != null ? nextEventWeek(lastStopWeek + 1) : null;

  // Inline filter controls (replaces the old gear/filter sheet).
  const setYear = (y: number) =>
    pushParams((p) => {
      p.set('year', String(y));
      // Chains are per-year (edition ids). The target year's own chain is
      // restored from its sessionStorage mirror on mount.
      p.delete('build');
    });
  const toggleGroup = (g: LevelGroup) => {
    const next = new Set(data.groups);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    if (next.size === 0) return; // keep at least one level on
    pushParams((p) => p.set('scope', [...next].join('+')));
  };
  const toggleSurface = (s: string) => {
    const next = new Set(surfaces ?? []);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    pushParams((p) => {
      if (next.size === 0) p.delete('surface');
      else p.set('surface', [...next].join(','));
    });
  };

  return (
    <div className="swings-root">
      <div className="swings-map-wrap">
        <SwingsMap
          events={mode === 'build' ? builderMapEvents : exploreEvents}
          swings={data.swings}
          visibleSwingIndexes={visibleSwingIndexes}
          selectedSwingIndex={selectedSwing}
          onSelectSwing={selectSwing}
          initialCenter={initialCenter}
          initialZoom={4}
          fitPoints={fitPoints}
          fitNonce={fitNonce}
          builderActive={mode === 'build'}
          builderPath={chain.map((e) => [e.latitude!, e.longitude!] as [number, number])}
          onPickEvent={addStop}
        />
      </div>

      {/* Floating glass control cluster over the full-bleed map */}
      <div className="swings-float">
        <div className="swings-filters" role="group" aria-label="Filters">
          <select
            className="filter-select"
            aria-label="Season"
            value={data.year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {SEASONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="filter-sep" aria-hidden="true" />
          {(['atp', 'challenger', 'itf'] as LevelGroup[]).map((g) => (
            <button
              key={g}
              className={`filter-chip${data.groups.includes(g) ? ' filter-chip--on' : ''}`}
              onClick={() => toggleGroup(g)}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
          <span className="filter-sep" aria-hidden="true" />
          {SURFACES.map((s) => (
            <button
              key={s}
              className={`filter-chip${surfaces?.has(s) ? ' filter-chip--on' : ''}`}
              onClick={() => toggleSurface(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <Timeline
          year={data.year}
          selectedWeek={selectedWeek}
          weekCounts={weekCounts}
          markedWeeks={mode === 'build' ? chainWeeks : undefined}
          onSelect={(w) => {
            setSelectedWeek(w);
            setSelectedSwing(null);
          }}
        />
      </div>

      {showWelcome && (
        <div className="welcome-backdrop" onClick={dismissWelcome}>
          <div
            className="welcome-card"
            role="dialog"
            aria-label="Welcome"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="welcome-kicker">Tennis Cuts</p>
            <h2 className="welcome-title">Plan your season.</h2>
            <p className="welcome-copy">
              Build a week-by-week swing across ATP, Challenger and ITF events — and see
              where your ranking would have gotten in.
            </p>
            <p className="welcome-copy welcome-copy--how">
              Tap any tournament to preview its cuts, then hit <strong>＋ Add</strong> to
              put it on your schedule.
            </p>
            <label className="rank-field">
              <span>Your singles rank (optional)</span>
              <input
                className="rank-input"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="e.g. 250"
                value={rankSingles ?? ''}
                onChange={(ev) => {
                  const v = Number(ev.target.value);
                  updateRankSingles(Number.isFinite(v) && v > 0 ? v : null);
                }}
              />
            </label>
            <button className="welcome-start" onClick={dismissWelcome}>
              Start building →
            </button>
            <button className="welcome-skip" onClick={dismissWelcome}>
              Just explore the map
            </button>
          </div>
        </div>
      )}

      {infoEvent && (
        <TournamentInfoCard
          event={infoEvent.event}
          series={data.cutSeries[infoEvent.event.slug]}
          refs={data.cutRefs[infoEvent.event.slug]}
          projections={data.cutProjections[infoEvent.event.slug]}
          year={data.year}
          onAdd={
            infoEvent.canAdd
              ? () => {
                  addStop(infoEvent.event.editionId);
                  setInfoEvent(null);
                }
              : undefined
          }
          onClose={() => setInfoEvent(null)}
        />
      )}

      {mode === 'build' ? (
        <BuilderPanel
          state={sheet}
          setState={setSheet}
          year={data.year}
          chain={chain}
          candidates={candidates}
          summary={chainSummary}
          selectedWeek={selectedWeek}
          weekCounts={weekCounts}
          nextWeek={nextEventWeek(selectedWeek + 1)}
          prevWeek={prevEventWeek(selectedWeek - 1)}
          lastStopWeek={lastStopWeek}
          resumeWeek={resumeWeek}
          onGoToWeek={setSelectedWeek}
          onAdd={addStop}
          onRemove={removeStop}
          onClear={clearChain}
          onInfo={(event, canAdd) => setInfoEvent({ event, canAdd: Boolean(canAdd) })}
          rankSingles={rankSingles}
          rankDoubles={rankDoubles}
          onRankSingles={updateRankSingles}
          onRankDoubles={updateRankDoubles}
          singlesStatuses={singlesStatuses}
          doublesStatuses={doublesStatuses}
          singlesSummary={singlesSummary}
          doublesSummary={doublesSummary}
          cutRefs={data.cutRefs}
          imperial={imperial}
        />
      ) : (
        <BottomSheet
          state={sheet}
          setState={setSheet}
          year={data.year}
          swingsThisWeek={swingsThisWeek}
          nearestUpcoming={nearestUpcoming}
          activeSwing={activeSwing}
          onPickSwing={selectSwing}
          onJumpToWeek={(w) => {
            setSelectedWeek(w);
            setSelectedSwing(null);
          }}
        />
      )}
    </div>
  );
}

// --- Season timeline ----------------------------------------------------------
// Replaces the flat 52-pill week strip: weeks are grouped under month anchors
// and each week carries a density bar (tournaments matching the current
// filters), so the shape of the season is readable at a glance.
function Timeline({
  year,
  selectedWeek,
  weekCounts,
  markedWeeks,
  onSelect,
}: {
  year: number;
  selectedWeek: number;
  weekCounts: number[];
  /** Weeks holding one of the user's swing stops — ringed in the strip. */
  markedWeeks?: Set<number>;
  onSelect: (week: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedWeek]);

  // Group consecutive weeks by the month their Monday falls in.
  const months = useMemo(() => {
    const out: Array<{ label: string; weeks: Array<{ week: number; day: number }> }> = [];
    for (let w = 1; w <= MAX_WEEK; w++) {
      const d = weekStart(year, w);
      const label = MONTHS[d.getUTCMonth()];
      const last = out[out.length - 1];
      const entry = { week: w, day: d.getUTCDate() };
      if (last && last.label === label) last.weeks.push(entry);
      else out.push({ label, weeks: [entry] });
    }
    return out;
  }, [year]);

  const maxCount = Math.max(1, ...weekCounts);

  return (
    <div className="timeline" role="tablist" aria-label="Weeks">
      {months.map((m, mi) => (
        <div key={`${m.label}-${mi}`} className="timeline__month">
          <span className="timeline__month-label">{m.label}</span>
          <div className="timeline__weeks">
            {m.weeks.map(({ week, day }) => {
              const count = weekCounts[week] ?? 0;
              // sqrt scale keeps busy ITF weeks from flattening everything else
              const h = count === 0 ? 2 : 3 + Math.round((Math.sqrt(count) / Math.sqrt(maxCount)) * 13);
              const on = week === selectedWeek;
              const stop = markedWeeks?.has(week) ?? false;
              return (
                <button
                  key={week}
                  ref={on ? selectedRef : undefined}
                  role="tab"
                  aria-selected={on}
                  aria-label={`Week of ${weekDateLabel(year, week)} — ${count} tournament${count === 1 ? '' : 's'}${stop ? ' (on your swing)' : ''}`}
                  title={`${weekDateLabel(year, week)} · ${count} tournament${count === 1 ? '' : 's'}${stop ? ' · on your swing' : ''}`}
                  className={`timeline__week${on ? ' timeline__week--on' : ''}${stop ? ' timeline__week--stop' : ''}`}
                  onClick={() => onSelect(week)}
                >
                  <span className="timeline__bar" style={{ height: h }} aria-hidden="true" />
                  <span className="timeline__day">{day}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Builder panel ----------------------------------------------------------
function BuilderPanel({
  state,
  setState,
  year,
  chain,
  candidates,
  summary,
  selectedWeek,
  weekCounts,
  nextWeek,
  prevWeek,
  lastStopWeek,
  resumeWeek,
  onGoToWeek,
  onAdd,
  onRemove,
  onClear,
  onInfo,
  rankSingles,
  rankDoubles,
  onRankSingles,
  onRankDoubles,
  singlesStatuses,
  doublesStatuses,
  singlesSummary,
  doublesSummary,
  cutRefs,
  imperial,
}: {
  state: SheetState;
  setState: (s: SheetState) => void;
  year: number;
  chain: SwingMapEvent[];
  candidates: RankedCandidate<SwingMapEvent>[];
  summary: ReturnType<typeof summarizeChain>;
  selectedWeek: number;
  weekCounts: number[];
  /** Nearest week after/before the selected one that has events (null = none). */
  nextWeek: number | null;
  prevWeek: number | null;
  /** Latest stop's week and the first event week after it (the scheduling frontier). */
  lastStopWeek: number | null;
  resumeWeek: number | null;
  onGoToWeek: (week: number) => void;
  onAdd: (editionId: string) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  /** Opens the tournament info popover (cut line + link to the full page). */
  /** Open the info popover; canAdd shows its "Add to schedule" action. */
  onInfo: (event: SwingMapEvent, canAdd?: boolean) => void;
  rankSingles: number | null;
  rankDoubles: number | null;
  onRankSingles: (rank: number | null) => void;
  onRankDoubles: (rank: number | null) => void;
  singlesStatuses: EntryStatus[];
  doublesStatuses: EntryStatus[];
  singlesSummary: ReturnType<typeof summarizeEntries>;
  doublesSummary: ReturnType<typeof summarizeEntries>;
  cutRefs: SwingsPageData['cutRefs'];
  imperial: boolean;
}) {
  const { gripHandlers, sheetStyle, toggle } = useSheetDrag(state, setState);
  const [editingRank, setEditingRank] = useState(false);

  // All candidates are for one week; group by relationship tier (same country
  // first). Before an anchor exists there's no relationship, so show a flat list.
  const hasAnchor = chain.length > 0;

  // One-time coach hint for the add flow — new users don't guess that rows
  // preview and the pill adds. Remembered once dismissed or once the first
  // stop lands on the schedule.
  const [showAddHint, setShowAddHint] = useState(false);
  useEffect(() => {
    try {
      setShowAddHint(!localStorage.getItem('swings.hint.add') && chain.length === 0);
    } catch {
      setShowAddHint(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (chain.length > 0 && showAddHint) {
      setShowAddHint(false);
      try {
        localStorage.setItem('swings.hint.add', '1');
      } catch {
        // ignore
      }
    }
  }, [chain.length, showAddHint]);
  const dismissAddHint = () => {
    setShowAddHint(false);
    try {
      localStorage.setItem('swings.hint.add', '1');
    } catch {
      // ignore
    }
  };
  const addHint = showAddHint ? (
    <div className="add-hint" role="note">
      <span>
        Tap a tournament to <strong>preview its cuts</strong> · hit <strong>＋ Add</strong> to
        put it on your schedule
      </span>
      <button type="button" className="add-hint__close" onClick={dismissAddHint} aria-label="Dismiss hint">
        ✕
      </button>
    </div>
  ) : null;
  const grouped = useMemo(() => {
    const byTier = new Map<CandidateTier, RankedCandidate<SwingMapEvent>[]>();
    for (const c of candidates) {
      const list = byTier.get(c.tier) ?? [];
      list.push(c);
      byTier.set(c.tier, list);
    }
    return TIER_ORDER.map((tier) => ({ tier, items: byTier.get(tier) ?? [] })).filter(
      (g) => g.items.length > 0
    );
  }, [candidates]);

  const candidateRow = (c: RankedCandidate<SwingMapEvent>) => {
    const ref = cutRefs[c.event.slug];
    const sMeta = STATUS_META[entryStatus(rankSingles, ref?.singles)];
    const dMeta = STATUS_META[entryStatus(rankDoubles, ref?.doubles)];
    const singlesOnly = isSinglesOnly(c.event.level);
    const showDoubles = rankDoubles != null && !singlesOnly;
    return (
      <li key={c.event.editionId}>
        {/* div-with-role instead of <button> so the nested buttons stay valid HTML.
            Tapping the row opens the info card with an explicit "Add to schedule"
            action — instant add on a full-row tap was too easy to hit by accident.
            The + button on the right remains the deliberate one-tap add. */}
        <div
          className="cand-row"
          role="button"
          tabIndex={0}
          onClick={() => onInfo(c.event, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onInfo(c.event, true);
            }
          }}
        >
          <span className="cand-week">{weekDateLabel(year, c.event.week)}</span>
          <span className="cand-main">
            <span className="cand-name">
              {c.event.name}
              <button
                type="button"
                className="info-dot"
                aria-label={`Cut history for ${c.event.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo(c.event, true);
                }}
              >
                i
              </button>
            </span>
            <span className="cand-meta">
              {c.event.city} · {c.event.level} · {c.event.surface}
              {c.distanceKm != null && ` · ${formatDistance(c.distanceKm, imperial)}`}
              {hasAnchor && !c.sameSurface && ' · surface change'}
            </span>
          </span>
          {(rankSingles != null || showDoubles) && (
            <span className="entry-pills entry-pills--cand">
              {rankSingles != null && (
                <span className="entry-pill" style={{ color: sMeta.color, borderColor: sMeta.color }}>
                  S·{sMeta.short}
                </span>
              )}
              {showDoubles && (
                <span className="entry-pill" style={{ color: dMeta.color, borderColor: dMeta.color }}>
                  D·{dMeta.short}
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            className="cand-add"
            aria-label={`Add ${c.event.name} to schedule`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd(c.event.editionId);
            }}
          >
            ＋ Add
          </button>
        </div>
      </li>
    );
  };

  // Rank inputs are shared by both the start-list view and the swing view so a
  // player can enter their ranking up front and immediately see in/out pills.
  const rankFields = (
    <div className="rank-inputs">
      <label className="rank-field">
        <span>Singles rank</span>
        <input
          className="rank-input"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="e.g. 250"
          value={rankSingles ?? ''}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            onRankSingles(Number.isFinite(v) && v > 0 ? v : null);
          }}
        />
      </label>
      <label className="rank-field">
        <span>Combined doubles rank</span>
        <input
          className="rank-input"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="e.g. 180"
          value={rankDoubles ?? ''}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            onRankDoubles(Number.isFinite(v) && v > 0 ? v : null);
          }}
        />
      </label>
    </div>
  );

  // Compact key for the entry-status pills + a note that cuts are historical.
  // Only shown once a ranking is entered (i.e. when pills are actually visible),
  // so it never crowds the empty state.
  const showRank = rankSingles != null || rankDoubles != null;
  const rankLegend = showRank ? (
    <div className="rank-legend">
      <ul className="rank-legend-keys">
        {(['main', 'qualifying', 'out'] as EntryStatus[]).map((s) => (
          <li key={s} className="rank-legend-key">
            <span className="rank-legend-dot" style={{ background: STATUS_META[s].color }} />
            <span className="rank-legend-short" style={{ color: STATUS_META[s].color }}>
              {STATUS_META[s].short}
            </span>
            <span className="rank-legend-label">{STATUS_META[s].label}</span>
          </li>
        ))}
      </ul>
      <p className="rank-legend-note">Based on last year&rsquo;s entry cuts.</p>
    </div>
  ) : null;

  // Pinned, always-visible rank bar at the top of the sheet. Shows the entered
  // ranking ("You: #250 singles · #180 doubles") with an edit affordance, and
  // flips to the compact inputs when editing or before a ranking is set.
  const rankBar = (
    <div className="rank-bar">
      {showRank && !editingRank ? (
        <button className="rank-bar-display" onClick={() => setEditingRank(true)}>
          <span className="rank-bar-you">You</span>
          {rankSingles != null && <span className="rank-bar-val">#{rankSingles} singles</span>}
          {rankSingles != null && rankDoubles != null && <span className="rank-bar-sep">·</span>}
          {rankDoubles != null && <span className="rank-bar-val">#{rankDoubles} doubles</span>}
          <span className="rank-bar-edit" aria-hidden="true">✎</span>
        </button>
      ) : (
        <div className="rank-bar-form">
          {rankFields}
          {showRank && (
            <div className="rank-bar-actions">
              <button
                className="rank-bar-clear"
                onClick={() => {
                  onRankSingles(null);
                  onRankDoubles(null);
                }}
              >
                Clear
              </button>
              <button className="rank-bar-done" onClick={() => setEditingRank(false)}>
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Week stepper: chevrons jump between weeks that actually have events, so
  // stepping never lands on a dead week.
  const weekNav = (title: string) => (
    <div className="weeknav">
      <button
        className="weeknav__btn"
        disabled={prevWeek == null}
        onClick={() => prevWeek != null && onGoToWeek(prevWeek)}
        aria-label={prevWeek != null ? `Back to ${weekDateLabel(year, prevWeek)}` : 'No earlier week with tournaments'}
        title={prevWeek != null ? `Back to ${weekDateLabel(year, prevWeek)}` : undefined}
      >
        ‹
      </button>
      <h3 className="weeknav__title">{title}</h3>
      <button
        className="weeknav__btn"
        disabled={nextWeek == null}
        onClick={() => nextWeek != null && onGoToWeek(nextWeek)}
        aria-label={nextWeek != null ? `Ahead to ${weekDateLabel(year, nextWeek)}` : 'No later week with tournaments'}
        title={nextWeek != null ? `Ahead to ${weekDateLabel(year, nextWeek)}` : undefined}
      >
        ›
      </button>
    </div>
  );

  // True when the user is reviewing weeks at/behind their latest stop — the
  // useful jump from there is back to the scheduling frontier, not the next
  // calendar week (which often lands mid-chain and reads as a dead end).
  const behindFrontier = lastStopWeek != null && selectedWeek <= lastStopWeek;
  const stopsThisWeek = chain.filter((e) => e.week === selectedWeek);

  const resumeButton =
    behindFrontier && resumeWeek != null ? (
      <button className="builder-jump" onClick={() => onGoToWeek(resumeWeek)}>
        Resume scheduling — {weekDateLabel(year, resumeWeek)} · {weekCounts[resumeWeek]}{' '}
        tournament{weekCounts[resumeWeek] === 1 ? '' : 's'} →
      </button>
    ) : null;

  // Rich empty state: explains why the week is empty and offers one-tap jumps
  // — resume-after-your-last-stop first, never a dead end.
  const emptyWeek = (
    <div className="builder-empty">
      {stopsThisWeek.length > 0 ? (
        <>
          <p className="builder-empty__title">
            You&rsquo;re set for {weekDateLabel(year, selectedWeek)}
          </p>
          <p className="builder-empty__hint">
            {stopsThisWeek.map((e) => e.name).join(' and ')} is already on your swing this
            week; nothing else matches your filters.
          </p>
        </>
      ) : (
        <>
          <p className="builder-empty__title">
            Nothing the week of {weekDateLabel(year, selectedWeek)}
          </p>
          <p className="builder-empty__hint">
            No tournaments match your level &amp; surface filters this week — weeks with a
            taller bar in the timeline above have events.
          </p>
        </>
      )}
      {resumeButton ??
        (nextWeek != null && (
          <button className="builder-jump" onClick={() => onGoToWeek(nextWeek)}>
            Jump to {weekDateLabel(year, nextWeek)} · {weekCounts[nextWeek]}{' '}
            tournament{weekCounts[nextWeek] === 1 ? '' : 's'} →
          </button>
        ))}
      {prevWeek != null && (
        <button className="builder-jump builder-jump--ghost" onClick={() => onGoToWeek(prevWeek)}>
          ← Back to {weekDateLabel(year, prevWeek)}
        </button>
      )}
      {nextWeek == null && prevWeek == null && (
        <p className="builder-empty__hint">
          Nothing matches these filters in {year} — try turning more levels or surfaces on above.
        </p>
      )}
    </div>
  );

  const skipButton =
    behindFrontier && resumeWeek != null ? (
      <button className="builder-skip" onClick={() => onGoToWeek(resumeWeek)}>
        ↪ Resume scheduling after {weekDateLabel(year, lastStopWeek!)} —{' '}
        {weekDateLabel(year, resumeWeek)} →
      </button>
    ) : nextWeek != null ? (
      <button className="builder-skip" onClick={() => onGoToWeek(nextWeek)}>
        Nothing here for you? Skip to {weekDateLabel(year, nextWeek)} →
      </button>
    ) : null;

  return (
    <section className={`sheet sheet--${state}`} style={sheetStyle} aria-label="Swing builder">
      <div className="sheet-grip-row" {...gripHandlers}>
        <button
          className="sheet-grip"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          aria-label="Drag to resize panel"
        />
      </div>
      {rankBar}
      <div className="sheet-body">
        {!hasAnchor ? (
          <>
            <h2 className="sheet-title">Build your own swing</h2>
            {showRank ? (
              <div className="rank-check">{rankLegend}</div>
            ) : (
              <p className="rank-hint">
                Enter your ranking above to see entry status on each tournament below.
              </p>
            )}
            {weekNav(`Week of ${weekDateLabel(year, selectedWeek)} — pick your start`)}
            {candidates.length === 0 ? (
              emptyWeek
            ) : (
              <>
                {addHint}
                <ul className="cand-list">{candidates.map(candidateRow)}</ul>
                {skipButton}
              </>
            )}
          </>
        ) : (
          <>
            <div className="sheet-head">
              <h2 className="sheet-title">Your swing</h2>
              <button className="builder-clear" onClick={onClear}>Clear</button>
            </div>
            {summary && (
              <div className="sheet-badges">
                <span className="badge">{chain.length} stop{chain.length > 1 ? 's' : ''}</span>
                <span className="badge">{weekRangeLabel(year, summary.startWeek, summary.endWeek)}</span>
                <span className={`badge ${summary.surfaceConsistent ? 'badge--ok' : 'badge--mixed'}`}>
                  {summary.surfaceConsistent ? summary.surfaces[0] : `Mixed: ${summary.surfaces.join('/')}`}
                </span>
                {/* max-hop badge removed: per-leg distances already show on each
                    candidate row, where the decision is actually made. */}
              </div>
            )}

            {showRank && (
              <div className="rank-check">
                {rankSingles != null && (
                  <p className="rank-summary">
                    <span className="rank-summary-tag">S</span> {describeEntrySummary(singlesSummary)}
                  </p>
                )}
                {rankDoubles != null && (
                  <p className="rank-summary">
                    <span className="rank-summary-tag">D</span> {describeEntrySummary(doublesSummary)}
                  </p>
                )}
                {rankLegend}
              </div>
            )}

            <ul className="itinerary">
              {chain.map((e, i) => {
                const ref = cutRefs[e.slug];
                const sMeta = STATUS_META[singlesStatuses[i]];
                const dMeta = STATUS_META[doublesStatuses[i]];
                const showDoubles = rankDoubles != null && !isSinglesOnly(e.level);
                return (
                  <li key={e.editionId} className="itinerary-row">
                    <span className="itinerary-week">{i + 1}. {weekDateLabel(year, e.week)}</span>
                    <span className="itinerary-main">
                      <a className="itinerary-link" href={`/tournaments/${e.slug}`}>{e.name}</a>
                      <button
                        type="button"
                        className="info-dot"
                        aria-label={`Cut history for ${e.name}`}
                        onClick={() => onInfo(e)}
                      >
                        i
                      </button>
                    </span>
                    <span className="entry-pills">
                      {rankSingles != null && (
                        <span
                          className="entry-pill"
                          style={{ color: sMeta.color, borderColor: sMeta.color }}
                          title={
                            ref?.singles.fromYear
                              ? `Singles ${ref.singles.fromYear} cut — MD ${ref.singles.mainCut ?? '–'}, Q ${ref.singles.qualCut ?? '–'}`
                              : 'No singles cut on record'
                          }
                        >
                          S·{sMeta.short}
                        </span>
                      )}
                      {showDoubles && (
                        <span
                          className="entry-pill"
                          style={{ color: dMeta.color, borderColor: dMeta.color }}
                          title={
                            ref?.doubles.fromYear
                              ? `Doubles ${ref.doubles.fromYear} cut — MD ${ref.doubles.mainCut ?? '–'}`
                              : 'No doubles cut on record'
                          }
                        >
                          D·{dMeta.short}
                        </span>
                      )}
                    </span>
                    <button className="chain-remove" onClick={() => onRemove(i)} aria-label="Remove">✕</button>
                  </li>
                );
              })}
            </ul>

            <a
              className="builder-finish"
              href={`/schedule?build=${chain.map((e) => e.editionId).join(',')}&year=${year}`}
            >
              Complete schedule — see summary →
            </a>

            {weekNav(`Week of ${weekDateLabel(year, selectedWeek)} — pick your next stop`)}
            {grouped.length === 0 ? (
              emptyWeek
            ) : (
              <>
                {grouped.map((g) => (
                  <div key={g.tier} className="cand-group">
                    <p className={`cand-group-head cand-tier--${g.tier}`}>{TIER_LABELS[g.tier]}</p>
                    <ul className="cand-list">{g.items.map(candidateRow)}</ul>
                  </div>
                ))}
                {skipButton}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// --- Bottom sheet (explore) -------------------------------------------------
function BottomSheet({
  state,
  setState,
  year,
  swingsThisWeek,
  nearestUpcoming,
  activeSwing,
  onPickSwing,
  onJumpToWeek,
}: {
  state: SheetState;
  setState: (s: SheetState) => void;
  year: number;
  swingsThisWeek: SwingsPageData['swings'];
  nearestUpcoming: SwingsPageData['swings'][number] | null;
  activeSwing: SwingsPageData['swings'][number] | null;
  onPickSwing: (index: number) => void;
  onJumpToWeek: (week: number) => void;
}) {
  const { gripHandlers, sheetStyle, toggle } = useSheetDrag(state, setState);

  return (
    <section className={`sheet sheet--${state}`} style={sheetStyle} aria-label="Swing details">
      <div className="sheet-grip-row" {...gripHandlers}>
        <button
          className="sheet-grip"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          aria-label="Drag to resize details"
        />
      </div>

      {activeSwing ? (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2 className="sheet-title">{activeSwing.label}</h2>
            <span className="sheet-weeks">
              {weekRangeLabel(year, activeSwing.startWeek, activeSwing.endWeek)} · {activeSwing.totalWeeks} wk
            </span>
          </div>
          <div className="sheet-badges">
            {activeSwing.kind === 'series' && <span className="badge badge--series">Series · same city</span>}
            <span className={`badge ${activeSwing.surfaceConsistent ? 'badge--ok' : 'badge--mixed'}`}>
              {activeSwing.surfaceConsistent ? activeSwing.surfaces[0] : `Mixed: ${activeSwing.surfaces.join('/')}`}
            </span>
            <span className="badge">{activeSwing.tierMix}</span>
          </div>
          <ul className="itinerary">
            {activeSwing.itinerary.map((row) =>
              row.events.map((e) => (
                <li key={e.slug + row.week} className="itinerary-row">
                  <span className="itinerary-week">{weekDateLabel(year, row.week)}</span>
                  <a className="itinerary-link" href={`/tournaments/${e.slug}`}>{e.name}</a>
                  <span className="itinerary-meta">{e.surface}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <div className="sheet-body">
          {swingsThisWeek.length > 0 ? (
            <>
              <p className="sheet-summary">{thisWeekSummary(swingsThisWeek)}</p>
              <ul className="swing-list">
                {swingsThisWeek.map((s) => (
                  <li key={s.index}>
                    <button className="swing-list-row" onClick={() => onPickSwing(s.index)}>
                      <span className="swing-list-label">
                        {s.label}
                        {s.kind === 'series' && <span className="swing-list-tag">series</span>}
                      </span>
                      <span className="swing-list-meta">
                        {weekRangeLabel(year, s.startWeek, s.endWeek)} · {s.tierMix}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : nearestUpcoming ? (
            <p className="sheet-summary">
              No swings this week — nearest:{' '}
              <button className="sheet-jump" onClick={() => onJumpToWeek(nearestUpcoming.startWeek)}>
                {nearestUpcoming.label} starting {weekDateLabel(year, nearestUpcoming.startWeek)}
              </button>
            </p>
          ) : (
            <p className="sheet-summary">No upcoming swings for this filter.</p>
          )}
        </div>
      )}
    </section>
  );
}

// --- Tournament info popover -------------------------------------------------
// Opened from the ⓘ dot on builder rows: the tournament's cut line, the latest
// reference cuts, a reserved slot for the beta cut projection, and an explicit
// link to the full tournament page (tapping a candidate row adds it to the
// swing, so the page link needs its own affordance).
function MiniCutLine({ points, label }: { points: Array<[number, number]>; label: string }) {
  const n = points.length;
  const PAD = 16;
  const STEP = n <= 4 ? 58 : 44;
  const LABEL = 16;
  const PLOT = 52;
  const AXIS = 14;
  const values = points.map((p) => p[1]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = Math.max((max - min) * 0.35, max * 0.06, 8);
  const lo = min - pad;
  const hi = max + pad;
  const w = PAD * 2 + (n - 1) * STEP;
  const h = LABEL + PLOT + AXIS;
  const base = LABEL + PLOT;
  const X = (i: number) => PAD + i * STEP;
  const Y = (c: number) => LABEL + (1 - (c - lo) / (hi - lo)) * PLOT;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${path} L${X(n - 1)},${base} L${X(0)},${base} Z`;
  const below = (i: number) =>
    points[i][1] <= (points[i - 1]?.[1] ?? Infinity) && points[i][1] <= (points[i + 1]?.[1] ?? Infinity);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="tinfo-chart"
      role="img"
      aria-label={`${label} cut by year: ${points.map((p) => `${p[0]} #${p[1]}`).join(', ')}`}
    >
      <line x1={0} y1={base + 0.5} x2={w} y2={base + 0.5} className="cut-trend__baseline" />
      <path d={area} className="cut-trend__area" />
      <path d={path} className="cut-trend__line" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map(([yr, c], i) => (
        <g key={yr}>
          <circle cx={X(i)} cy={Y(c)} r={4} strokeWidth={2} className="cut-trend__dot" />
          <text x={X(i)} y={below(i) ? Y(c) + 15 : Y(c) - 8} textAnchor="middle" className="cut-trend__value">
            {c}
          </text>
          <text x={X(i)} y={base + 11} textAnchor="middle" className="cut-trend__year">
            {String(yr).slice(2)}
          </text>
        </g>
      ))}
    </svg>
  );
}

const INFO_DRAWS: Array<{ key: keyof CutSeriesByDraw; tab: string; label: string }> = [
  { key: 'm', tab: 'Singles', label: 'Singles main-draw' },
  { key: 'q', tab: 'Singles Q', label: 'Singles qualifying' },
  { key: 'd', tab: 'Doubles', label: 'Doubles main-draw' },
];

function TournamentInfoCard({
  event,
  series,
  refs,
  projections,
  year,
  onAdd,
  onClose,
}: {
  event: SwingMapEvent;
  series: CutSeriesByDraw | undefined;
  refs: SwingsPageData['cutRefs'][string] | undefined;
  projections: CutProjectionsByDraw | undefined;
  year: number;
  /** When set (candidate rows), the card shows an explicit add action. */
  onAdd?: () => void;
  onClose: () => void;
}) {
  // Slams split draws across two events: the main slam has no qualifying tab
  // (quali is its own event the week before) and the quali event is only the
  // singles-qualifying line.
  const drawChoices =
    event.level === 'Grand Slam Qualifying'
      ? INFO_DRAWS.filter((d) => d.key === 'q')
      : event.level === 'Grand Slam'
        ? INFO_DRAWS.filter((d) => d.key !== 'q')
        : INFO_DRAWS;
  const [drawKey, setDrawKey] = useState<keyof CutSeriesByDraw>(drawChoices[0].key);
  const draw = drawChoices.find((d) => d.key === drawKey) ?? drawChoices[0];
  const points = series?.[draw.key] ?? [];
  const projection = projections?.[draw.key];

  // Latest reference cut for the active draw (2026 stops reference last year).
  const singlesRef = refs?.singles;
  const doublesRef = refs?.doubles;
  let refText: string | null = null;
  if (draw.key === 'm' && singlesRef?.fromYear != null && (singlesRef.mainAlt ?? singlesRef.mainCut) != null) {
    refText = `${singlesRef.fromYear} cut — MD #${singlesRef.mainAlt ?? singlesRef.mainCut}`;
  } else if (draw.key === 'q' && singlesRef?.fromYear != null && singlesRef.qualCut != null) {
    refText = `${singlesRef.fromYear} cut — Q #${singlesRef.qualCut}`;
  } else if (draw.key === 'd' && doublesRef?.fromYear != null && (doublesRef.mainAlt ?? doublesRef.mainCut) != null) {
    refText = `${doublesRef.fromYear} cut — MD #${doublesRef.mainAlt ?? doublesRef.mainCut}`;
  }
  const refLine = refText ? <p className="tinfo-line">{refText}</p> : null;

  return (
    <div className="tinfo-backdrop" onClick={onClose}>
      <div className="tinfo-card" role="dialog" aria-label={event.name} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tinfo-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3 className="tinfo-name">{event.name}</h3>
        <p className="tinfo-meta">
          {event.city}
          {event.country ? `, ${event.country}` : ''} · {event.level} · {event.surface}
        </p>
        {drawChoices.length > 1 && (
        <div className="cut-trend__tabs tinfo-tabs" role="tablist" aria-label="Draw">
          {drawChoices.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={d.key === drawKey}
              className={`cut-trend__tab${d.key === drawKey ? ' cut-trend__tab--on' : ''}`}
              onClick={() => setDrawKey(d.key)}
            >
              {d.tab}
            </button>
          ))}
        </div>
        )}
        {points.length >= 2 ? (
          <>
            <p className="tinfo-label">{draw.label} cut by year</p>
            <MiniCutLine points={points} label={draw.label} />
            {refLine}
          </>
        ) : points.length === 1 ? (
          <>
            <p className="tinfo-line">
              {points[0][0]} {draw.label.toLowerCase()} cut — #{points[0][1]}
            </p>
            {refLine}
          </>
        ) : refLine ? (
          refLine
        ) : (
          <p className="tinfo-line tinfo-line--muted">No {draw.label.toLowerCase()} cut history on record yet.</p>
        )}
        {projection ? (
          <p className="tinfo-beta tinfo-beta--live">
            Projected cut · <strong>~#{projection.cut}</strong>{' '}
            <span>
              range {projection.low}–{projection.high} · beta
            </span>
          </p>
        ) : (
          <p className="tinfo-beta">
            Projected cut · <span>beta — coming soon</span>
          </p>
        )}
        {onAdd && (
          <button type="button" className="tinfo-open tinfo-add" onClick={onAdd}>
            ＋ Add to schedule
          </button>
        )}
        <a
          className={`tinfo-open${onAdd ? ' tinfo-open--secondary' : ''}`}
          href={`/tournaments/${event.slug}?year=${year}`}
        >
          View full tournament page →
        </a>
      </div>
    </div>
  );
}

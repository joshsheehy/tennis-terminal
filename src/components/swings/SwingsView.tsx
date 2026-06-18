'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SwingsPageData, SwingMapEvent } from '@/lib/swings-page-data';
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
const SURFACES = ['Hard', 'Clay', 'Grass', 'Indoor Hard'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUP_LABELS: Record<LevelGroup, string> = { atp: 'ATP', challenger: 'Challenger', itf: 'ITF' };

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
function weekMonth(year: number, week: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const isoDow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const offset = isoDow <= 3 ? 1 - isoDow : 8 - isoDow;
  const monday = new Date(jan1.getTime() + (offset + (week - 1) * 7) * 86400000);
  return monday.getUTCMonth();
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
  const [chainIds, setChainIds] = useState<string[]>(() =>
    (params.get('build')?.split(',') ?? []).filter((id) => id.length > 0)
  );
  const [selectedWeek, setSelectedWeek] = useState(() =>
    Math.min(MAX_WEEK, Math.max(1, data.currentWeek))
  );
  const [selectedSwing, setSelectedSwing] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>(mode === 'build' ? 'half' : 'collapsed');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fitNonce, setFitNonce] = useState(1);
  const [rankSingles, setRankSingles] = useState<number | null>(null);
  const [rankDoubles, setRankDoubles] = useState<number | null>(null);

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
    (surface: string) => !surfaces || surfaces.size === 0 || surfaces.has(surface),
    [surfaces]
  );

  useEffect(() => setFitNonce((n) => n + 1), [selectedWeek, selectedSwing, mode, chainIds.length]);

  // --- shared helpers -------------------------------------------------------
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mut(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  // Keep the ?build= param in sync without a server round-trip.
  const syncBuildParam = (ids: string[]) => {
    const next = new URLSearchParams(params.toString());
    if (ids.length) next.set('build', ids.join(','));
    else next.delete('build');
    window.history.replaceState(null, '', `${pathname}?${next.toString()}`);
  };

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
    // Advance to choosing the following week.
    setSelectedWeek(Math.min(MAX_WEEK, ev.week + 1));
    syncBuildParam(next);
  };

  const skipWeek = () => setSelectedWeek((w) => Math.min(MAX_WEEK, w + 1));
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
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedWeek, selectedSwing, surfaces]);

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
      .map((c) => ({ ...c.event, dim: false, builderRole: 'candidate', tier: c.tier }));
    return [...chainEvents, ...candEvents];
  }, [mode, chain, candidates, rankSingles, rankDoubles, singlesStatuses, doublesStatuses]);

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

  return (
    <div className="swings-root">
      <header className="swings-header">
        <div>
          <p className="swings-eyebrow">{mode === 'build' ? 'Builder' : 'Swings'}</p>
          <h1 className="swings-title">
            {mode === 'build' ? 'Build your swing' : `${data.year} travel chains`}
          </h1>
        </div>
        <div className="swings-header-actions">
          <button className="swings-filter-btn" onClick={() => setFiltersOpen(true)} aria-label="Filters">
            ⚙︎
          </button>
        </div>
      </header>

      <WeekStrip
        year={data.year}
        selectedWeek={selectedWeek}
        onSelect={(w) => {
          setSelectedWeek(w);
          setSelectedSwing(null);
        }}
      />

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

      {mode === 'build' ? (
        <BuilderPanel
          state={sheet}
          setState={setSheet}
          chain={chain}
          candidates={candidates}
          summary={chainSummary}
          selectedWeek={selectedWeek}
          onAdd={addStop}
          onRemove={removeStop}
          onClear={clearChain}
          onSkip={skipWeek}
          rankSingles={rankSingles}
          rankDoubles={rankDoubles}
          onRankSingles={updateRankSingles}
          onRankDoubles={updateRankDoubles}
          singlesStatuses={singlesStatuses}
          doublesStatuses={doublesStatuses}
          singlesSummary={singlesSummary}
          doublesSummary={doublesSummary}
          cutRefs={data.cutRefs}
        />
      ) : (
        <BottomSheet
          state={sheet}
          setState={setSheet}
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

      {filtersOpen && (
        <FilterSheet
          data={data}
          surfaces={surfaces}
          onClose={() => setFiltersOpen(false)}
          onYear={(y) => pushParams((p) => p.set('year', String(y)))}
          onToggleGroup={(g) => {
            const next = new Set(data.groups);
            if (next.has(g)) next.delete(g);
            else next.add(g);
            if (next.size === 0) return;
            pushParams((p) => p.set('scope', [...next].join('+')));
          }}
          onToggleSurface={(s) => {
            const next = new Set(surfaces ?? []);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            pushParams((p) => {
              if (next.size === 0) p.delete('surface');
              else p.set('surface', [...next].join(','));
            });
          }}
        />
      )}
    </div>
  );
}

// --- Week strip -------------------------------------------------------------
function WeekStrip({
  year,
  selectedWeek,
  onSelect,
}: {
  year: number;
  selectedWeek: number;
  onSelect: (week: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedWeek]);

  const weeks = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
  return (
    <div className="week-strip" role="tablist" aria-label="Weeks">
      {weeks.map((w) => {
        const showMonth = w === 1 || weekMonth(year, w) !== weekMonth(year, w - 1);
        return (
          <div className="week-cell" key={w}>
            <span className="week-month">{showMonth ? MONTHS[weekMonth(year, w)] : ' '}</span>
            <button
              ref={w === selectedWeek ? selectedRef : undefined}
              role="tab"
              aria-selected={w === selectedWeek}
              className={`week-pill${w === selectedWeek ? ' week-pill--active' : ''}`}
              onClick={() => onSelect(w)}
            >
              W{w}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// --- Builder panel ----------------------------------------------------------
function BuilderPanel({
  state,
  setState,
  chain,
  candidates,
  summary,
  selectedWeek,
  onAdd,
  onRemove,
  onClear,
  onSkip,
  rankSingles,
  rankDoubles,
  onRankSingles,
  onRankDoubles,
  singlesStatuses,
  doublesStatuses,
  singlesSummary,
  doublesSummary,
  cutRefs,
}: {
  state: SheetState;
  setState: (s: SheetState) => void;
  chain: SwingMapEvent[];
  candidates: RankedCandidate<SwingMapEvent>[];
  summary: ReturnType<typeof summarizeChain>;
  selectedWeek: number;
  onAdd: (editionId: string) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onSkip: () => void;
  rankSingles: number | null;
  rankDoubles: number | null;
  onRankSingles: (rank: number | null) => void;
  onRankDoubles: (rank: number | null) => void;
  singlesStatuses: EntryStatus[];
  doublesStatuses: EntryStatus[];
  singlesSummary: ReturnType<typeof summarizeEntries>;
  doublesSummary: ReturnType<typeof summarizeEntries>;
  cutRefs: SwingsPageData['cutRefs'];
}) {
  const cycleUp = () => setState(state === 'collapsed' ? 'half' : 'full');
  const cycleDown = () => setState(state === 'full' ? 'half' : 'collapsed');

  // All candidates are for one week; group by relationship tier (same country
  // first). Before an anchor exists there's no relationship, so show a flat list.
  const hasAnchor = chain.length > 0;
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

  const candidateRow = (c: RankedCandidate<SwingMapEvent>) => (
    <li key={c.event.editionId}>
      <button className="cand-row" onClick={() => onAdd(c.event.editionId)}>
        <span className="cand-week">W{c.event.week}</span>
        <span className="cand-main">
          <span className="cand-name">{c.event.name}</span>
          <span className="cand-meta">
            {c.event.city} · {c.event.level} · {c.event.surface}
            {c.distanceKm != null && ` · ${Math.round(c.distanceKm)} km`}
            {hasAnchor && !c.sameSurface && ' · surface change'}
          </span>
        </span>
        <span className="cand-add">+</span>
      </button>
    </li>
  );

  const skipButton = (
    <button className="builder-skip" onClick={onSkip}>
      Nothing for week {selectedWeek}? Skip to week {Math.min(selectedWeek + 1, MAX_WEEK)} →
    </button>
  );

  return (
    <section className={`sheet sheet--${state}`} aria-label="Swing builder">
      <div className="sheet-grip-row">
        <button className="sheet-grip" onClick={state === 'full' ? cycleDown : cycleUp} aria-label="Toggle" />
      </div>
      <div className="sheet-body">
        {!hasAnchor ? (
          <>
            <h2 className="sheet-title">Build your own swing</h2>
            <p className="sheet-summary">Pick a starting tournament in week {selectedWeek}.</p>
            <ul className="cand-list">{candidates.map(candidateRow)}</ul>
            {candidates.length === 0 && (
              <p className="sheet-summary">No tournaments in week {selectedWeek} for this filter.</p>
            )}
            {skipButton}
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
                <span className="badge">W{summary.startWeek}–W{summary.endWeek}</span>
                <span className={`badge ${summary.surfaceConsistent ? 'badge--ok' : 'badge--mixed'}`}>
                  {summary.surfaceConsistent ? summary.surfaces[0] : `Mixed: ${summary.surfaces.join('/')}`}
                </span>
                {summary.maxHopKm != null && (
                  <span className="badge">max hop {Math.round(summary.maxHopKm)} km</span>
                )}
              </div>
            )}

            <div className="rank-check">
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
            </div>

            <ul className="itinerary">
              {chain.map((e, i) => {
                const ref = cutRefs[e.slug];
                const sMeta = STATUS_META[singlesStatuses[i]];
                const dMeta = STATUS_META[doublesStatuses[i]];
                return (
                  <li key={e.editionId} className="itinerary-row">
                    <span className="itinerary-week">{i + 1}. W{e.week}</span>
                    <a className="itinerary-link" href={`/tournaments/${e.slug}`}>{e.name}</a>
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
                      {rankDoubles != null && (
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

            <h3 className="builder-subhead">Week {selectedWeek} — pick your next stop</h3>
            {grouped.length === 0 ? (
              <p className="sheet-summary">No tournaments in week {selectedWeek} for this filter.</p>
            ) : (
              grouped.map((g) => (
                <div key={g.tier} className="cand-group">
                  <p className={`cand-group-head cand-tier--${g.tier}`}>{TIER_LABELS[g.tier]}</p>
                  <ul className="cand-list">{g.items.map(candidateRow)}</ul>
                </div>
              ))
            )}
            {skipButton}
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
  swingsThisWeek,
  nearestUpcoming,
  activeSwing,
  onPickSwing,
  onJumpToWeek,
}: {
  state: SheetState;
  setState: (s: SheetState) => void;
  swingsThisWeek: SwingsPageData['swings'];
  nearestUpcoming: SwingsPageData['swings'][number] | null;
  activeSwing: SwingsPageData['swings'][number] | null;
  onPickSwing: (index: number) => void;
  onJumpToWeek: (week: number) => void;
}) {
  const cycleUp = () => setState(state === 'collapsed' ? 'half' : 'full');
  const cycleDown = () => setState(state === 'full' ? 'half' : 'collapsed');

  return (
    <section className={`sheet sheet--${state}`} aria-label="Swing details">
      <div className="sheet-grip-row">
        <button className="sheet-grip" onClick={state === 'full' ? cycleDown : cycleUp} aria-label="Toggle details" />
      </div>

      {activeSwing ? (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2 className="sheet-title">{activeSwing.label}</h2>
            <span className="sheet-weeks">
              W{activeSwing.startWeek}–W{activeSwing.endWeek} · {activeSwing.totalWeeks} wk
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
                  <span className="itinerary-week">W{row.week}</span>
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
                        W{s.startWeek}–W{s.endWeek} · {s.tierMix}
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
                {nearestUpcoming.label} starting W{nearestUpcoming.startWeek}
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

// --- Filter sheet -----------------------------------------------------------
function FilterSheet({
  data,
  surfaces,
  onClose,
  onYear,
  onToggleGroup,
  onToggleSurface,
}: {
  data: SwingsPageData;
  surfaces: Set<string> | null;
  onClose: () => void;
  onYear: (year: number) => void;
  onToggleGroup: (group: LevelGroup) => void;
  onToggleSurface: (surface: string) => void;
}) {
  const years = [2026, 2025, 2024];
  const groups: LevelGroup[] = ['atp', 'challenger', 'itf'];
  return (
    <div className="filter-overlay" onClick={onClose}>
      <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="filter-head">
          <h2>Filters</h2>
          <button className="filter-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <fieldset className="filter-group">
          <legend>Year</legend>
          <div className="chip-row">
            {years.map((y) => (
              <button key={y} className={`chip${data.year === y ? ' chip--on' : ''}`} onClick={() => onYear(y)}>
                {y}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Levels</legend>
          <div className="chip-row">
            {groups.map((g) => (
              <button
                key={g}
                className={`chip${data.groups.includes(g) ? ' chip--on' : ''}`}
                onClick={() => onToggleGroup(g)}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Surface</legend>
          <div className="chip-row">
            {SURFACES.map((s) => (
              <button key={s} className={`chip${surfaces?.has(s) ? ' chip--on' : ''}`} onClick={() => onToggleSurface(s)}>
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

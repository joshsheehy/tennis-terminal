'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SwingsPageData } from '@/lib/swings-page-data';
import type { LevelGroup } from '@/lib/swings';
import type { MapEvent } from './SwingsMap';

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

// "2 swings · 1 series this week" — counts the two kinds separately.
function thisWeekSummary(items: SwingsPageData['swings']): string {
  const swings = items.filter((s) => s.kind === 'swing').length;
  const series = items.filter((s) => s.kind === 'series').length;
  const parts: string[] = [];
  if (swings) parts.push(`${swings} swing${swings > 1 ? 's' : ''}`);
  if (series) parts.push(`${series} series`);
  return `${parts.join(' · ')} this week`;
}

// Monday (UTC) of an ATP week, mirroring getAtpSeasonStartDateUtc.
function weekMonth(year: number, week: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const isoDow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const offset = isoDow <= 3 ? 1 - isoDow : 8 - isoDow;
  const monday = new Date(jan1.getTime() + (offset + (week - 1) * 7) * 86400000);
  return monday.getUTCMonth();
}

export default function SwingsView({ data }: { data: SwingsPageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [selectedWeek, setSelectedWeek] = useState(() =>
    Math.min(MAX_WEEK, Math.max(1, data.currentWeek))
  );
  const [selectedSwing, setSelectedSwing] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>('collapsed');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fitNonce, setFitNonce] = useState(1);

  const surfaces = useMemo(() => {
    const raw = params.get('surface');
    return raw ? new Set(raw.split(',').filter((s) => SURFACES.includes(s))) : null;
  }, [params]);

  const surfaceOk = useCallback(
    (surface: string) => !surfaces || surfaces.size === 0 || surfaces.has(surface),
    [surfaces]
  );

  // Reframe map when week or selected swing changes.
  useEffect(() => setFitNonce((n) => n + 1), [selectedWeek, selectedSwing]);

  // --- derived view data ----------------------------------------------------
  const inWindow = (week: number) => week >= selectedWeek && week <= selectedWeek + LOOKAHEAD;

  const visibleEvents: MapEvent[] = useMemo(() => {
    const selectedEditionIds =
      selectedSwing != null ? new Set(data.swings[selectedSwing].editionIds) : null;
    return data.events
      .filter((e) => {
        if (!surfaceOk(e.surface)) return false;
        if (selectedEditionIds?.has(e.editionId)) return true; // whole selected chain
        return inWindow(e.week);
      })
      .map((e) => ({
        ...e,
        dim: selectedEditionIds?.has(e.editionId) ? false : e.week !== selectedWeek,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedWeek, selectedSwing, surfaces]);

  const visibleSwingIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const s of data.swings) {
      if (!s.surfaces.some(surfaceOk)) continue;
      const intersects = s.startWeek <= selectedWeek + LOOKAHEAD && s.endWeek >= selectedWeek;
      if (intersects) set.add(s.index);
    }
    if (selectedSwing != null) set.add(selectedSwing);
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedWeek, selectedSwing, surfaces]);

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

  const fitPoints: [number, number][] = useMemo(() => {
    if (selectedSwing != null) {
      const p = data.swings[selectedSwing].path;
      if (p.length) return p.map((q) => [q.lat, q.lng]);
    }
    const wk = visibleEvents.filter((e) => e.week === selectedWeek);
    const pts = (wk.length ? wk : visibleEvents).map((e) => [e.latitude, e.longitude] as [number, number]);
    return pts;
  }, [data, selectedSwing, visibleEvents, selectedWeek]);

  const initialCenter: [number, number] = fitPoints[0] ?? [25, 5];

  // --- navigation helpers ---------------------------------------------------
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mut(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  const selectSwing = (index: number | null) => {
    setSelectedSwing(index);
    if (index != null) {
      setSheet('half');
      // jump the week to the swing's start so its chain is in the window
      setSelectedWeek(Math.min(MAX_WEEK, Math.max(1, data.swings[index].startWeek)));
    }
  };

  const activeSwing = selectedSwing != null ? data.swings[selectedSwing] : null;

  return (
    <div className="swings-root">
      <header className="swings-header">
        <div>
          <p className="swings-eyebrow">Swings</p>
          <h1 className="swings-title">{data.year} travel chains</h1>
        </div>
        <button className="swings-filter-btn" onClick={() => setFiltersOpen(true)} aria-label="Filters">
          ⚙︎ Filters
        </button>
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
          events={visibleEvents}
          swings={data.swings}
          visibleSwingIndexes={visibleSwingIndexes}
          selectedSwingIndex={selectedSwing}
          onSelectSwing={selectSwing}
          initialCenter={initialCenter}
          initialZoom={4}
          fitPoints={fitPoints}
          fitNonce={fitNonce}
        />
      </div>

      <BottomSheet
        state={sheet}
        setState={setSheet}
        swingsThisWeek={swingsThisWeek}
        nearestUpcoming={nearestUpcoming}
        activeSwing={activeSwing}
        onPickSwing={(i) => selectSwing(i)}
        onJumpToWeek={(w) => {
          setSelectedWeek(w);
          setSelectedSwing(null);
        }}
      />

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
            if (next.size === 0) return; // never empty
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
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedWeek]);

  const weeks = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
  return (
    <div className="week-strip" ref={stripRef} role="tablist" aria-label="Weeks">
      {weeks.map((w) => {
        const showMonth = w === 1 || weekMonth(year, w) !== weekMonth(year, w - 1);
        return (
          <div className="week-cell" key={w}>
            <span className="week-month">{showMonth ? MONTHS[weekMonth(year, w)] : ' '}</span>
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

// --- Bottom sheet -----------------------------------------------------------
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
                  <a className="itinerary-link" href={`/tournaments/${e.slug}`}>
                    {e.name}
                  </a>
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
          <button className="filter-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <fieldset className="filter-group">
          <legend>Year</legend>
          <div className="chip-row">
            {years.map((y) => (
              <button
                key={y}
                className={`chip${data.year === y ? ' chip--on' : ''}`}
                onClick={() => onYear(y)}
              >
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
              <button
                key={s}
                className={`chip${surfaces?.has(s) ? ' chip--on' : ''}`}
                onClick={() => onToggleSurface(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

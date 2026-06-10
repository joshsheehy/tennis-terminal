'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScheduleRow } from '@/lib/types';

function normalizeForSearch(value: string | null | undefined) {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function displayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA';
  // Format in UTC so a stored '2026-01-05' always renders as "Jan 5" regardless
  // of the viewer's local timezone — otherwise negative-offset zones (US/Americas)
  // shift it back to Jan 4.
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dateString));
}

function getDateValue(dateString: string | null) {
  if (!dateString) return Number.MAX_SAFE_INTEGER;
  const v = new Date(dateString).getTime();
  return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
}

function getLevelSortValue(level: string) {
  const n = level.toLowerCase();
  if (n.includes('1000')) return 1000;
  if (n.includes('500')) return 500;
  if (n.includes('250')) return 250;
  if (n.includes('challenger 175')) return 175;
  if (n.includes('challenger 125')) return 125;
  if (n.includes('challenger 100')) return 100;
  if (n.includes('challenger 75')) return 75;
  if (n.includes('challenger 50')) return 50;
  if (n.includes('challenger')) return 1;
  return 0;
}

function getLevelCategory(level: string): string {
  const n = level.toLowerCase();
  if (n.includes('1000') || n.includes('500') || n.includes('250')) return 'ATP';
  if (n.includes('challenger')) return 'Challenger';
  return 'Other';
}

type WeekGroup = { key: string; week: number | null; tournaments: DisplayTournament[]; startDate: string | null };
type DisplayTournament = { tournament: ScheduleRow; displayWeek: number | null };

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function parseDate(s: string | null) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getWeekStartUtc(date: Date) {
  const day = date.getUTCDay();
  const ws = new Date(date);
  ws.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  ws.setUTCHours(0, 0, 0, 0);
  return ws;
}

function extraWeeks(startDate: string | null, endDate: string | null) {
  const s = parseDate(startDate);
  const e = parseDate(endDate);
  if (!s || !e) return 0;
  const sw = getWeekStartUtc(s).getTime();
  const ew = getWeekStartUtc(e).getTime();
  return ew <= sw ? 0 : Math.floor((ew - sw) / MS_PER_WEEK);
}

function vibrate() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(8);
  }
}

export default function WeekTournamentPicker({
  tournaments,
  year = 2026,
  defaultWeekKey,
}: {
  tournaments: ScheduleRow[];
  year?: number;
  defaultWeekKey?: string;
}) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const weekRef     = useRef<HTMLDivElement>(null);
  const resultsRef  = useRef<HTMLDivElement>(null);
  const noMatchRef  = useRef<HTMLDivElement>(null);
  const countRef    = useRef<HTMLDivElement>(null);
  const clearRef    = useRef<HTMLButtonElement>(null);

  // Chip filter state — refs drive the DOM filter logic; state drives the chip button re-renders
  const activeSurfacesRef = useRef<Set<string>>(new Set());
  const activeLevelsRef   = useRef<Set<string>>(new Set());
  const [chipSurfaces, setChipSurfaces] = useState<Set<string>>(new Set());
  const [chipLevels,   setChipLevels]   = useState<Set<string>>(new Set());

  // Tracks whether chip filtering has mutated the week groups (hidden rows /
  // weeks, rewritten counts) so they can be restored when filters clear.
  const weekGroupsMutated = useRef(false);

  const sortedTournaments = useMemo(() =>
    [...tournaments].sort((a, b) => {
      const d = getDateValue(a.start_date) - getDateValue(b.start_date);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    }), [tournaments]);

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const expanded: DisplayTournament[] = [];
    for (const t of tournaments) {
      expanded.push({ tournament: t, displayWeek: t.week });
      if (t.week !== null) {
        for (let i = 1; i <= extraWeeks(t.start_date, t.end_date); i++) {
          expanded.push({ tournament: t, displayWeek: t.week + i });
        }
      }
    }
    const map = new Map<string, DisplayTournament[]>();
    for (const e of expanded) {
      const k = e.displayWeek === null ? 'na' : String(e.displayWeek);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries())
      .map(([key, items]) => {
        const sorted = [...items].sort((a, b) => {
          const ld = getLevelSortValue(b.tournament.level) - getLevelSortValue(a.tournament.level);
          if (ld !== 0) return ld;
          const dd = getDateValue(a.tournament.start_date) - getDateValue(b.tournament.start_date);
          return dd !== 0 ? dd : a.tournament.name.localeCompare(b.tournament.name);
        });
        const week = key === 'na' ? null : Number(key);
        const primary = sorted.filter(i => i.displayWeek === i.tournament.week);
        const src = primary.length > 0 ? primary : sorted;
        const startDate = src.reduce<string | null>((earliest, i) => {
          if (!i.tournament.start_date) return earliest;
          if (!earliest) return i.tournament.start_date;
          return getDateValue(i.tournament.start_date) < getDateValue(earliest)
            ? i.tournament.start_date : earliest;
        }, null);
        return { key, week, tournaments: sorted, startDate };
      })
      .sort((a, b) => a.week === null ? 1 : b.week === null ? -1 : a.week - b.week);
  }, [tournaments]);

  // Available filter options derived from data
  const surfaces = useMemo(() => {
    const s = new Set<string>();
    for (const t of tournaments) if (t.surface) s.add(t.surface);
    const preferred = ['Hard', 'Clay', 'Grass', 'Indoor Hard', 'Carpet'];
    const ordered = preferred.filter(x => s.has(x));
    for (const x of s) if (!ordered.includes(x)) ordered.push(x);
    return ordered;
  }, [tournaments]);

  const levelCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of tournaments) cats.add(getLevelCategory(t.level));
    return ['ATP', 'Challenger', 'Other'].filter(c => cats.has(c));
  }, [tournaments]);

  // Key of the week group that contains today — used to auto-open it on mount
  const currentWeekKey = useMemo(() => {
    const today = Date.now();
    let bestKey: string | null = null;
    let bestTime = -Infinity;
    for (const g of weekGroups) {
      if (!g.startDate) continue;
      const t = new Date(g.startDate + 'T00:00:00Z').getTime();
      if (t <= today && t > bestTime) {
        bestTime = t;
        bestKey = g.key;
      }
    }
    return bestKey;
  }, [weekGroups]);

  // Open the target week before first paint, then scroll to it.
  // Priority: URL ?week= param → sessionStorage (back-navigation) → computed current week.
  // sessionStorage is the reliable fallback for back navigation because
  // history.replaceState can be lost when Next.js's router pushes a new entry.
  useLayoutEffect(() => {
    const stored = sessionStorage.getItem('openWeek');
    const keyToOpen = defaultWeekKey ?? stored ?? currentWeekKey;
    if (!keyToOpen || !weekRef.current) return;
    const el = weekRef.current.querySelector<HTMLDetailsElement>(`[data-week-key="${keyToOpen}"]`);
    if (!el) return;
    el.open = true;
    const scroll = () => {
      const top = el.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo(0, Math.max(0, top));
    };
    const t1 = window.setTimeout(scroll, 100);
    const t2 = window.setTimeout(scroll, 400);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [defaultWeekKey, currentWeekKey]);

  const show = (el: HTMLElement | null, visible: boolean) => {
    if (el) el.style.display = visible ? '' : 'none';
  };

  // Undo the in-place mutations chip filtering makes to the week groups:
  // un-hide rows/weeks, reset each week's tournament count, and restore the
  // expand/collapse state that was in effect before filtering started.
  const restoreWeekGroups = useCallback(() => {
    if (!weekGroupsMutated.current) return;
    const root = weekRef.current;
    if (root) {
      root.querySelectorAll<HTMLElement>('[data-week-row]').forEach(el => { el.style.display = ''; });
      root.querySelectorAll<HTMLDetailsElement>('details[data-week-key]').forEach(d => {
        d.style.display = '';
        const countEl = d.querySelector<HTMLElement>('[data-week-count]');
        if (countEl) {
          const total = Number(countEl.dataset.weekTotal ?? '0');
          countEl.textContent = `${total} ${total === 1 ? 'tournament' : 'tournaments'}`;
        }
      });
    }
    weekGroupsMutated.current = false;
  }, []);

  const applyFilter = useCallback((rawValue: string) => {
    const query = rawValue.trim();
    const needle = normalizeForSearch(query);
    const surfaces = activeSurfacesRef.current;
    const levels   = activeLevelsRef.current;
    const hasChips = surfaces.size > 0 || levels.size > 0;

    // Nothing active → default week-grouped view.
    if (!needle && !hasChips) {
      restoreWeekGroups();
      show(weekRef.current, true);
      show(resultsRef.current, false);
      show(noMatchRef.current, false);
      show(countRef.current, false);
      show(clearRef.current, false);
      return;
    }

    // Search text active → flat results list (chips, if any, also narrow it).
    if (needle) {
      restoreWeekGroups();
      show(clearRef.current, true);
      show(weekRef.current, false);

      let count = 0;
      resultsRef.current?.querySelectorAll<HTMLElement>('[data-search]').forEach(el => {
        const searchMatch  = (el.getAttribute('data-search') ?? '').includes(needle);
        const surfaceMatch = surfaces.size === 0 || surfaces.has(el.getAttribute('data-surface') ?? '');
        const levelMatch   = levels.size === 0 || levels.has(el.getAttribute('data-level-cat') ?? '');
        const matches = searchMatch && surfaceMatch && levelMatch;
        el.style.display = matches ? '' : 'none';
        if (matches) count++;
      });

      show(resultsRef.current, count > 0);
      show(noMatchRef.current, count === 0);
      show(countRef.current, count > 0);
      if (countRef.current) {
        countRef.current.textContent = `${count} ${count === 1 ? 'match' : 'matches'} for "${query}"`;
      }
      if (noMatchRef.current && count === 0) {
        noMatchRef.current.textContent = `No tournaments match your filters for ${year}.`;
      }
      return;
    }

    // Chips only → keep the week-grouped dropdown view, filtering rows within it.
    show(resultsRef.current, false);
    show(weekRef.current, true);
    show(clearRef.current, false);
    show(countRef.current, false);

    const root = weekRef.current;
    if (!root) return;
    weekGroupsMutated.current = true;

    let total = 0;
    root.querySelectorAll<HTMLDetailsElement>('details[data-week-key]').forEach(d => {
      let c = 0;
      d.querySelectorAll<HTMLElement>('[data-week-row]').forEach(row => {
        const surfaceMatch = surfaces.size === 0 || surfaces.has(row.getAttribute('data-surface') ?? '');
        const levelMatch   = levels.size === 0 || levels.has(row.getAttribute('data-level-cat') ?? '');
        const matches = surfaceMatch && levelMatch;
        row.style.display = matches ? '' : 'none';
        if (matches) c++;
      });
      const countEl = d.querySelector<HTMLElement>('[data-week-count]');
      if (countEl) countEl.textContent = `${c} ${c === 1 ? 'tournament' : 'tournaments'}`;
      d.style.display = c > 0 ? '' : 'none';
      total += c;
    });

    show(noMatchRef.current, total === 0);
    if (noMatchRef.current && total === 0) {
      noMatchRef.current.textContent = `No tournaments match your filters for ${year}.`;
    }
  }, [year, restoreWeekGroups]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.value) applyFilter(el.value);
    const handle = () => applyFilter(el.value);
    el.addEventListener('input', handle);
    return () => el.removeEventListener('input', handle);
  }, [applyFilter]);

  const clearSearch = useCallback(() => {
    vibrate();
    if (inputRef.current) { inputRef.current.value = ''; inputRef.current.focus(); }
    applyFilter('');
  }, [applyFilter]);

  const toggleSurface = useCallback((surface: string) => {
    vibrate();
    const next = new Set(activeSurfacesRef.current);
    if (next.has(surface)) next.delete(surface); else next.add(surface);
    activeSurfacesRef.current = next;
    setChipSurfaces(new Set(next));
    applyFilter(inputRef.current?.value ?? '');
  }, [applyFilter]);

  const toggleLevel = useCallback((level: string) => {
    vibrate();
    const next = new Set(activeLevelsRef.current);
    if (next.has(level)) next.delete(level); else next.add(level);
    activeLevelsRef.current = next;
    setChipLevels(new Set(next));
    applyFilter(inputRef.current?.value ?? '');
  }, [applyFilter]);

  // Open every currently-visible week. If everything visible is already open,
  // collapse them all instead — same button toggles direction so it doesn't
  // crowd the filter row with two pills. "Visible" means not hidden by an
  // active chip filter; filtered-out weeks keep whatever open state they had.
  //
  // The toggle event on <details> is dispatched asynchronously, so a flag
  // that flips back synchronously after the loop is racy. A short-lived
  // timestamp window is reliable: any onToggle that fires while the window
  // is open is treated as part of the bulk op and skips its side effects.
  const [allExpanded, setAllExpanded] = useState(false);
  const bulkToggleUntilRef = useRef(0);
  const handleExpandToggle = useCallback(() => {
    vibrate();
    const allDetails = weekRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-week-key]');
    if (!allDetails || allDetails.length === 0) return;
    const visible = Array.from(allDetails).filter((d) => d.style.display !== 'none');
    if (visible.length === 0) return;
    const anyClosed = visible.some((d) => !d.open);
    // Suppress per-week onToggle side effects for a tick — keeps us under
    // the browser's history.replaceState rate limit (~100 calls / 10s in
    // Safari/Chrome, which 40+ weeks × a few clicks blows past, crashing
    // the page with a SecurityError).
    bulkToggleUntilRef.current = Date.now() + 1000;
    for (const d of visible) d.open = anyClosed;
    setAllExpanded(anyClosed);
  }, []);

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 20,
    border: active ? '2px solid var(--text-strong)' : '1px solid var(--border-tag)',
    background: active ? 'var(--text-strong)' : 'var(--surface)',
    color: active ? 'var(--bg)' : 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    lineHeight: 1.4,
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          defaultValue=""
          onChange={e => applyFilter(e.target.value)}
          placeholder="Search tournaments by name, city, surface, or level"
          aria-label="Search tournaments"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="search"
          enterKeyHint="search"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 40px 12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-strong)',
            fontSize: 16,
            outline: 'none',
          }}
        />
        <button
          ref={clearRef}
          type="button"
          onClick={clearSearch}
          aria-label="Clear search"
          style={{
            display: 'none',
            position: 'absolute',
            top: '50%',
            right: 8,
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 18,
            padding: 6,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Filter chips + expand-all pill */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {surfaces.map(surface => (
          <button key={surface} onClick={() => toggleSurface(surface)} style={chipStyle(chipSurfaces.has(surface))}>
            {surface}
          </button>
        ))}
        {levelCategories.map(level => (
          <button key={level} onClick={() => toggleLevel(level)} style={chipStyle(chipLevels.has(level))}>
            {level}
          </button>
        ))}
        {/* Spacer pushes the expand toggle to the right on wide screens; on
            mobile it just wraps onto the next line with the other pills. */}
        <span style={{ flex: 1, minWidth: 0 }} />
        <button
          type="button"
          onClick={handleExpandToggle}
          aria-label={allExpanded ? 'Collapse all weeks' : 'Expand all weeks'}
          style={{
            ...chipStyle(allExpanded),
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 11, lineHeight: 1 }}>{allExpanded ? '▲' : '▼'}</span>
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {/* Match count */}
      <div
        ref={countRef}
        style={{ display: 'none', color: 'var(--text-muted)', padding: '4px 4px 0', fontSize: 13 }}
      />

      {/* No-match message */}
      <div
        ref={noMatchRef}
        style={{ display: 'none', color: 'var(--text-muted)', padding: '12px 4px', fontSize: 14 }}
      />

      {/* Flat search/filter results — always in DOM, shown/hidden via ref */}
      <div
        ref={resultsRef}
        style={{ display: 'none', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)' }}
      >
        {sortedTournaments.map((t, index) => (
          <div
            key={t.edition_id}
            data-search={normalizeForSearch(`${t.name} ${t.city} ${t.country ?? ''} ${t.level} ${t.surface}`)}
            data-surface={t.surface ?? ''}
            data-level-cat={getLevelCategory(t.level)}
          >
            <Link
              href={`/tournaments/${t.slug}${year !== 2026 ? `?year=${year}` : ''}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
                padding: '20px 24px',
                borderTop: index === 0 ? 'none' : '1px solid var(--border-inner)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 6 }}>
                  {displayName(t.name)}
                </div>
                <div style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  {t.city}{t.country ? `, ${t.country}` : ''}{' | '}
                  {t.start_date ? formatDate(t.start_date) : 'NA'}
                  {t.week ? ` | Week ${t.week}` : ''}
                </div>
                <div style={{ fontSize: 16, color: 'var(--text-strong)', fontWeight: 600 }}>
                  {t.level} · {t.surface}
                </div>
              </div>
              <div style={{ whiteSpace: 'nowrap', padding: '12px 18px', borderRadius: 12, border: '2px solid var(--text-strong)', background: 'var(--surface)', color: 'var(--text-strong)', fontWeight: 700, fontSize: 14 }}>
                Open
              </div>
            </Link>
          </div>
        ))}
      </div>

      {/* Week groups — always in DOM, hidden while searching/filtering */}
      <div ref={weekRef}>
        {weekGroups.map((group) => (
          <details
            key={group.key}
            data-week-key={group.key}
            onToggle={(e) => {
              if (!e.currentTarget.open) return;
              // Skip side effects when a bulk expand/collapse is in flight;
              // 40+ history.replaceState calls in one tick blow past the
              // Safari/Chrome rate limit and crash the page.
              if (Date.now() < bulkToggleUntilRef.current) return;
              try {
                sessionStorage.setItem('openWeek', group.key);
                const params = new URLSearchParams(window.location.search);
                params.set('week', group.key);
                history.replaceState(null, '', `?${params.toString()}`);
              } catch {
                // Browser threw (rate-limit, storage quota, etc.). Losing
                // the open-week persistence is fine — never crash the tree.
              }
            }}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 16,
              overflow: 'hidden',
              background: 'var(--surface)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              marginBottom: 16,
            }}
          >
            <summary
              style={{
                listStyle: 'none',
                cursor: 'pointer',
                padding: '22px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {group.week === null ? 'Week NA' : `Week ${group.week}`}
                  {group.key === currentWeekKey && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-tag)', border: '1px solid var(--border-tag)', borderRadius: 6, padding: '2px 8px' }}>
                      Current
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 18, color: 'var(--text-secondary)' }}>
                  {group.startDate ? formatDate(group.startDate) : 'NA'}
                  {' | '}
                  <span data-week-count data-week-total={group.tournaments.length}>
                    {group.tournaments.length}{' '}
                    {group.tournaments.length === 1 ? 'tournament' : 'tournaments'}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 18, color: 'var(--text-secondary)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                View all ▾
              </div>
            </summary>
            <div style={{ borderTop: '1px solid var(--border-inner)', background: 'var(--surface-alt)' }}>
              {group.tournaments.map(({ tournament, displayWeek }, i) => (
                <div
                  key={`${tournament.edition_id}-${displayWeek ?? 'na'}`}
                  data-week-row=""
                  data-surface={tournament.surface ?? ''}
                  data-level-cat={getLevelCategory(tournament.level)}
                >
                <Link
                  href={`/tournaments/${tournament.slug}${year !== 2026 ? `?year=${year}` : ''}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 20,
                    padding: '20px 24px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-inner)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {displayName(tournament.name)}
                      {displayWeek !== null && displayWeek !== tournament.week && (
                        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', background: 'var(--surface-tag)', border: '1px solid var(--border-tag)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                          in progress
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      {tournament.city}{tournament.country ? `, ${tournament.country}` : ''}{' | '}
                      {tournament.start_date ? formatDate(tournament.start_date) : 'NA'}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-strong)', fontWeight: 600 }}>
                      {tournament.level} · {tournament.surface}
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', padding: '10px 16px', borderRadius: 10, border: '2px solid var(--text-strong)', background: 'var(--surface)', color: 'var(--text-strong)', fontWeight: 700, fontSize: 13 }}>
                    Open
                  </div>
                </Link>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

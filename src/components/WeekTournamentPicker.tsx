'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(dateString),
  );
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

export default function WeekTournamentPicker({
  tournaments,
  year = 2026,
}: {
  tournaments: ScheduleRow[];
  year?: number;
}) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const weekRef     = useRef<HTMLDivElement>(null);
  const resultsRef  = useRef<HTMLDivElement>(null);
  const noMatchRef  = useRef<HTMLDivElement>(null);
  const countRef    = useRef<HTMLDivElement>(null);
  const clearRef    = useRef<HTMLButtonElement>(null);

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

  // Direct DOM filter — works without React re-renders, unaffected by
  // whether React's synthetic event delegation has fully initialised.
  const applyFilter = useCallback((rawValue: string) => {
    const query = rawValue.trim();
    const needle = normalizeForSearch(query);

    const show = (el: HTMLElement | null, visible: boolean) => {
      if (el) el.style.display = visible ? '' : 'none';
    };

    if (!needle) {
      show(weekRef.current, true);
      show(resultsRef.current, false);
      show(noMatchRef.current, false);
      show(countRef.current, false);
      show(clearRef.current, false);
      return;
    }

    show(clearRef.current, true);
    show(weekRef.current, false);

    let count = 0;
    resultsRef.current?.querySelectorAll<HTMLElement>('[data-search]').forEach(el => {
      const matches = (el.getAttribute('data-search') ?? '').includes(needle);
      el.style.display = matches ? '' : 'none';
      if (matches) count++;
    });

    show(resultsRef.current, count > 0);
    show(noMatchRef.current, count === 0);
    show(countRef.current, count > 0);

    if (countRef.current) {
      countRef.current.textContent =
        `${count} ${count === 1 ? 'match' : 'matches'} for "${query}"`;
    }
    if (noMatchRef.current && count === 0) {
      noMatchRef.current.textContent = `No tournaments match "${query}" for ${year}.`;
    }
  }, [year]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.value) applyFilter(el.value);
    const handle = () => applyFilter(el.value);
    el.addEventListener('input', handle);
    return () => el.removeEventListener('input', handle);
  }, [applyFilter]);

  const clearSearch = useCallback(() => {
    if (inputRef.current) { inputRef.current.value = ''; inputRef.current.focus(); }
    applyFilter('');
  }, [applyFilter]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          defaultValue=""
          onChange={e => applyFilter(e.target.value)}
          placeholder="Search tournaments by name, city, or level"
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
            border: '1px solid #d6d6d6',
            background: '#fff',
            color: '#0f172a',
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
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 18,
            padding: 6,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Match count */}
      <div
        ref={countRef}
        style={{ display: 'none', color: '#64748b', padding: '4px 4px 0', fontSize: 13 }}
      />

      {/* No-match message */}
      <div
        ref={noMatchRef}
        style={{ display: 'none', color: '#64748b', padding: '12px 4px', fontSize: 14 }}
      />

      {/* Flat search results — always in DOM, shown/hidden via ref */}
      <div
        ref={resultsRef}
        style={{ display: 'none', border: '1px solid #d6d6d6', borderRadius: 16, overflow: 'hidden', background: '#fff' }}
      >
        {sortedTournaments.map((t, index) => (
          <div
            key={t.edition_id}
            data-search={normalizeForSearch(`${t.name} ${t.city} ${t.country ?? ''} ${t.level}`)}
          >
            <Link
              href={`/tournaments/${t.slug}${year !== 2026 ? `?year=${year}` : ''}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
                padding: '20px 24px',
                borderTop: index === 0 ? 'none' : '1px solid #e5e7eb',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  {displayName(t.name)}
                </div>
                <div style={{ fontSize: 16, color: '#334155', marginBottom: 4 }}>
                  {t.city}{t.country ? `, ${t.country}` : ''}{' | '}
                  {t.start_date ? formatDate(t.start_date) : 'NA'}
                  {t.week ? ` | Week ${t.week}` : ''}
                </div>
                <div style={{ fontSize: 16, color: '#0f172a', fontWeight: 600 }}>
                  {t.level} · {t.surface}
                </div>
              </div>
              <div style={{ whiteSpace: 'nowrap', padding: '12px 18px', borderRadius: 12, border: '2px solid #0f172a', background: '#fff', color: '#0f172a', fontWeight: 700, fontSize: 14 }}>
                Open
              </div>
            </Link>
          </div>
        ))}
      </div>

      {/* Week groups — always in DOM, hidden while searching */}
      <div ref={weekRef}>
        {weekGroups.map((group) => (
          <details
            key={group.key}
            style={{
              border: '1px solid #d6d6d6',
              borderRadius: 16,
              overflow: 'hidden',
              background: '#fff',
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
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  {group.week === null ? 'Week NA' : `Week ${group.week}`}
                </div>
                <div style={{ fontSize: 18, color: '#334155' }}>
                  {group.startDate ? formatDate(group.startDate) : 'NA'}
                  {' | '}
                  {group.tournaments.length}{' '}
                  {group.tournaments.length === 1 ? 'tournament' : 'tournaments'}
                </div>
              </div>
              <div style={{ fontSize: 18, color: '#334155', fontWeight: 700, whiteSpace: 'nowrap' }}>
                View all ▾
              </div>
            </summary>
            <div style={{ borderTop: '1px solid #e5e7eb', background: '#fafafa' }}>
              {group.tournaments.map(({ tournament, displayWeek }, i) => (
                <Link
                  key={`${tournament.edition_id}-${displayWeek ?? 'na'}`}
                  href={`/tournaments/${tournament.slug}${year !== 2026 ? `?year=${year}` : ''}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 20,
                    padding: '20px 24px',
                    borderTop: i === 0 ? 'none' : '1px solid #e5e7eb',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      {displayName(tournament.name)}
                      {displayWeek !== null && displayWeek !== tournament.week && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          in progress
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 18, color: '#334155', marginBottom: 6 }}>
                      {tournament.city}{tournament.country ? `, ${tournament.country}` : ''}{' | '}
                      {tournament.start_date ? formatDate(tournament.start_date) : 'NA'}
                    </div>
                    <div style={{ fontSize: 18, color: '#0f172a', fontWeight: 600 }}>
                      {tournament.level} · {tournament.surface}
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', padding: '14px 20px', borderRadius: 12, border: '2px solid #0f172a', background: '#fff', color: '#0f172a', fontWeight: 700, fontSize: 16 }}>
                    Open
                  </div>
                </Link>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

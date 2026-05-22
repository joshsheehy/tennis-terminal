'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScheduleRow } from '@/lib/types';

function normalizeForSearch(value: string | null | undefined) {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function displayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString));
}

function getDateValue(dateString: string | null) {
  if (!dateString) return Number.MAX_SAFE_INTEGER;

  const value = new Date(dateString).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function getLevelSortValue(level: string) {
  const normalized = level.toLowerCase();

  if (normalized.includes('1000')) return 1000;
  if (normalized.includes('500')) return 500;
  if (normalized.includes('250')) return 250;
  if (normalized.includes('challenger 175')) return 175;
  if (normalized.includes('challenger 125')) return 125;
  if (normalized.includes('challenger 100')) return 100;
  if (normalized.includes('challenger 75')) return 75;
  if (normalized.includes('challenger 50')) return 50;
  if (normalized.includes('challenger')) return 1;

  return 0;
}

type WeekGroup = {
  key: string;
  week: number | null;
  tournaments: DisplayTournament[];
  startDate: string | null;
};

type DisplayTournament = {
  tournament: ScheduleRow;
  displayWeek: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function parseDate(dateString: string | null) {
  if (!dateString) return null;

  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekStartUtc(date: Date) {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() + mondayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  return weekStart;
}

function getAdditionalWeeksSpanned(startDate: string | null, endDate: string | null) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return 0;

  const startWeek = getWeekStartUtc(start).getTime();
  const endWeek = getWeekStartUtc(end).getTime();

  if (endWeek <= startWeek) return 0;

  return Math.floor((endWeek - startWeek) / MS_PER_WEEK);
}

export default function WeekTournamentPicker({
  tournaments,
  year = 2026,
}: {
  tournaments: ScheduleRow[];
  year?: number;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Sync any text the user typed before React hydrated this input.
    if (el.value) setSearch(el.value);
    // Attach a direct DOM listener so typing always updates state regardless
    // of whether React's synthetic event delegation is fully initialised.
    const sync = () => setSearch(el.value);
    el.addEventListener('input', sync);
    return () => el.removeEventListener('input', sync);
  }, []);

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const searchMatches = useMemo(() => {
    if (!isSearching) return [];
    const needle = normalizeForSearch(trimmedSearch);
    return tournaments
      .filter((t) => {
        const haystack = normalizeForSearch(`${t.name} ${t.city} ${t.country ?? ''} ${t.level}`);
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        const aDate = getDateValue(a.start_date);
        const bDate = getDateValue(b.start_date);
        if (aDate !== bDate) return aDate - bDate;
        return a.name.localeCompare(b.name);
      });
  }, [tournaments, trimmedSearch, isSearching]);

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const expanded: DisplayTournament[] = [];

    for (const tournament of tournaments) {
      expanded.push({
        tournament,
        displayWeek: tournament.week,
      });

      if (tournament.week === null) continue;

      const additionalWeeks = getAdditionalWeeksSpanned(
        tournament.start_date,
        tournament.end_date
      );

      for (let offset = 1; offset <= additionalWeeks; offset += 1) {
        expanded.push({
          tournament,
          displayWeek: tournament.week + offset,
        });
      }
    }

    const map = new Map<string, DisplayTournament[]>();

    for (const entry of expanded) {
      const key = entry.displayWeek === null ? 'na' : String(entry.displayWeek);

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(entry);
    }

    return Array.from(map.entries())
      .map(([key, items]) => {
        const sortedItems = [...items].sort((a, b) => {
          const levelDiff =
            getLevelSortValue(b.tournament.level) - getLevelSortValue(a.tournament.level);
          if (levelDiff !== 0) return levelDiff;

          const dateDiff =
            getDateValue(a.tournament.start_date) - getDateValue(b.tournament.start_date);
          if (dateDiff !== 0) return dateDiff;

          return a.tournament.name.localeCompare(b.tournament.name);
        });

        const week = key === 'na' ? null : Number(key);

        const newItems = sortedItems.filter((item) => item.displayWeek === item.tournament.week);
        const dateSourceItems = newItems.length > 0 ? newItems : sortedItems;
        const startDate = dateSourceItems.reduce<string | null>((earliest, item) => {
          if (!item.tournament.start_date) return earliest;
          if (!earliest) return item.tournament.start_date;
          return getDateValue(item.tournament.start_date) < getDateValue(earliest)
            ? item.tournament.start_date
            : earliest;
        }, null);

        return {
          key,
          week,
          tournaments: sortedItems,
          startDate,
        };
      })
      .sort((a, b) => {
        if (a.week === null) return 1;
        if (b.week === null) return -1;
        return a.week - b.week;
      });
  }, [tournaments]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
        {isSearching ? (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            style={{
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
        ) : null}
      </div>

      {isSearching ? (
        searchMatches.length === 0 ? (
          <div style={{ color: '#64748b', padding: '12px 4px', fontSize: 14 }}>
            No tournaments match &ldquo;{trimmedSearch}&rdquo; for {year}.
          </div>
        ) : (
          <div>
            <div style={{ color: '#64748b', padding: '4px 4px 8px', fontSize: 13 }}>
              {searchMatches.length} {searchMatches.length === 1 ? 'match' : 'matches'} for &ldquo;{trimmedSearch}&rdquo;
            </div>
            <div style={{ border: '1px solid #d6d6d6', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
              {searchMatches.map((tournament, index) => (
                <Link
                  key={tournament.edition_id}
                  href={`/tournaments/${tournament.slug}${year !== 2026 ? `?year=${year}` : ''}`}
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
                      {displayName(tournament.name)}
                    </div>
                    <div style={{ fontSize: 16, color: '#334155', marginBottom: 4 }}>
                      {tournament.city}
                      {tournament.country ? `, ${tournament.country}` : ''}
                      {' | '}
                      {tournament.start_date ? formatDate(tournament.start_date) : 'NA'}
                      {tournament.week ? ` | Week ${tournament.week}` : ''}
                    </div>
                    <div style={{ fontSize: 16, color: '#0f172a', fontWeight: 600 }}>
                      {tournament.level} · {tournament.surface}
                    </div>
                  </div>
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      padding: '12px 18px',
                      borderRadius: 12,
                      border: '2px solid #0f172a',
                      background: '#fff',
                      color: '#0f172a',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    Open
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )
      ) : (
        weekGroups.map((group) => (
          <details
            key={group.key}
            style={{
              border: '1px solid #d6d6d6',
              borderRadius: 16,
              overflow: 'hidden',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: 6,
                }}
              >
                {group.week === null ? 'Week NA' : `Week ${group.week}`}
              </div>

              <div
                style={{
                  fontSize: 18,
                  color: '#334155',
                }}
              >
                {group.startDate ? formatDate(group.startDate) : 'NA'}
                {' | '}
                {group.tournaments.length}{' '}
                {group.tournaments.length === 1 ? 'tournament' : 'tournaments'}
              </div>
            </div>

            <div
              style={{
                fontSize: 18,
                color: '#334155',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              View all ▾
            </div>
          </summary>

          <div
            style={{
              borderTop: '1px solid #e5e7eb',
              background: '#fafafa',
            }}
          >
            {group.tournaments.map(({ tournament, displayWeek }, tournamentIndex) => (
              <Link
                key={`${tournament.edition_id}-${displayWeek ?? 'na'}`}
                href={`/tournaments/${tournament.slug}${year !== 2026 ? `?year=${year}` : ''}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 20,
                  padding: '20px 24px',
                  borderTop: tournamentIndex === 0 ? 'none' : '1px solid #e5e7eb',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: '#0f172a',
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {displayName(tournament.name)}
                    {displayWeek !== null && displayWeek !== tournament.week && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#6b7280',
                          background: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          padding: '2px 8px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        in progress
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: 18,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    {tournament.city}
                    {tournament.country ? `, ${tournament.country}` : ''}
                    {' | '}
                    {tournament.start_date ? formatDate(tournament.start_date) : 'NA'}
                  </div>

                  <div
                    style={{
                      fontSize: 18,
                      color: '#0f172a',
                      fontWeight: 600,
                    }}
                  >
                    {tournament.level} · {tournament.surface}
                  </div>
                </div>

                <div
                  style={{
                    whiteSpace: 'nowrap',
                    padding: '14px 20px',
                    borderRadius: 12,
                    border: '2px solid #0f172a',
                    background: '#fff',
                    color: '#0f172a',
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  Open
                </div>
              </Link>
            ))}
          </div>
        </details>
        ))
      )}
    </div>
  );
}

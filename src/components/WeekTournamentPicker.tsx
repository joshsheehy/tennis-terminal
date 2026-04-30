'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleRow } from '@/lib/types';

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

type WeekGroup = {
  key: string;
  week: number | null;
  label: string;
  tournaments: ScheduleRow[];
};

export default function WeekTournamentPicker({
  tournaments,
}: {
  tournaments: ScheduleRow[];
}) {
  const router = useRouter();

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const map = new Map<string, ScheduleRow[]>();

    for (const tournament of tournaments) {
      const key = tournament.week === null ? 'na' : String(tournament.week);

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(tournament);
    }

    return Array.from(map.entries())
      .map(([key, items]) => {
        const sortedItems = [...items].sort((a, b) => {
          const dateDiff = getDateValue(a.start_date) - getDateValue(b.start_date);

          if (dateDiff !== 0) {
            return dateDiff;
          }

          return a.name.localeCompare(b.name);
        });

        const week = key === 'na' ? null : Number(key);
        const firstDate = sortedItems[0]?.start_date ?? null;

        return {
          key,
          week,
          label:
            week === null
              ? 'Week NA'
              : `Week ${week}${firstDate ? ` — ${formatDate(firstDate)}` : ''}`,
          tournaments: sortedItems,
        };
      })
      .sort((a, b) => {
        if (a.week === null) return 1;
        if (b.week === null) return -1;
        return a.week - b.week;
      });
  }, [tournaments]);

  const [selectedWeekKey, setSelectedWeekKey] = useState(weekGroups[0]?.key ?? '');
  const selectedWeek =
    weekGroups.find((group) => group.key === selectedWeekKey) ?? null;

  const [selectedSlug, setSelectedSlug] = useState('');

  useEffect(() => {
    if (selectedWeek?.tournaments?.length) {
      setSelectedSlug(selectedWeek.tournaments[0].slug);
    } else {
      setSelectedSlug('');
    }
  }, [selectedWeekKey, selectedWeek]);

  const selectedTournament =
    selectedWeek?.tournaments.find((tournament) => tournament.slug === selectedSlug) ??
    null;

  return (
    <div
      style={{
        display: 'grid',
        gap: '20px',
        maxWidth: 700,
        color: '#111',
      }}
    >
      <div>
        <label
          htmlFor="week-select"
          style={{ display: 'block', marginBottom: 8, color: '#111', fontWeight: 600 }}
        >
          Select week
        </label>
        <select
          id="week-select"
          value={selectedWeekKey}
          onChange={(e) => setSelectedWeekKey(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            color: '#111',
            background: '#fff',
            border: '1px solid #ccc',
          }}
        >
          {weekGroups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="tournament-select"
          style={{ display: 'block', marginBottom: 8, color: '#111', fontWeight: 600 }}
        >
          Tournaments in selected week
        </label>
        <select
          id="tournament-select"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          disabled={!selectedWeek}
          style={{
            width: '100%',
            padding: '10px',
            color: '#111',
            background: '#fff',
            border: '1px solid #ccc',
          }}
        >
          {selectedWeek?.tournaments.map((tournament) => (
            <option key={tournament.edition_id} value={tournament.slug}>
              {tournament.name} — {tournament.city}
            </option>
          ))}
        </select>
      </div>

      {selectedTournament && (
        <div
          style={{
            border: '1px solid #ccc',
            padding: '16px',
            background: '#fafafa',
            color: '#111',
          }}
        >
          <h2 style={{ marginTop: 0, color: '#111' }}>{selectedTournament.name}</h2>
          <p style={{ color: '#333' }}>
            {selectedTournament.city}
            {selectedTournament.country ? `, ${selectedTournament.country}` : ''}
          </p>
          <p style={{ color: '#333' }}>
            {selectedTournament.level} · {selectedTournament.surface}
          </p>
          <p style={{ color: '#333' }}>
            Week: {selectedTournament.week ?? 'NA'}
            <br />
            Start: {formatDate(selectedTournament.start_date)}
          </p>
          <button
            onClick={() => router.push(`/tournaments/${selectedTournament.slug}`)}
            style={{
              padding: '10px 14px',
              cursor: 'pointer',
              color: '#111',
              background: '#fff',
              border: '1px solid #999',
            }}
          >
            Open historical cuts
          </button>
        </div>
      )}
    </div>
  );
}

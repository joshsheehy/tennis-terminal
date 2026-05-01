'use client';

import Link from 'next/link';
import { useMemo } from 'react';
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
  tournaments: ScheduleRow[];
  startDate: string | null;
  endDate: string | null;
};

export default function WeekTournamentPicker({
  tournaments,
}: {
  tournaments: ScheduleRow[];
}) {
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
          if (dateDiff !== 0) return dateDiff;

          return a.name.localeCompare(b.name);
        });

        const week = key === 'na' ? null : Number(key);
        const startDate = sortedItems[0]?.start_date ?? null;

        const endDate = sortedItems.reduce<string | null>((latest, item) => {
          const candidate = item.end_date ?? item.start_date ?? null;
          if (!latest) return candidate;

          return getDateValue(candidate) > getDateValue(latest) ? candidate : latest;
        }, null);

        return {
          key,
          week,
          tournaments: sortedItems,
          startDate,
          endDate,
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
      {weekGroups.map((group, index) => (
        <details
          key={group.key}
          open={index === 0}
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
                {group.endDate ? ` - ${formatDate(group.endDate)}` : ''}
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
            {group.tournaments.map((tournament, tournamentIndex) => (
              <Link
                key={tournament.edition_id}
                href={`/tournaments/${tournament.slug}`}
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
                    }}
                  >
                    {tournament.name}
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
                    {tournament.end_date ? ` - ${formatDate(tournament.end_date)}` : ''}
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
      ))}
    </div>
  );
}

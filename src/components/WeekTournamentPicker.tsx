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

type TournamentEntry = ScheduleRow & { carryover: boolean };

type WeekGroup = {
  key: string;
  week: number | null;
  tournaments: TournamentEntry[];
  startDate: string | null;
};

export default function WeekTournamentPicker({
  tournaments,
}: {
  tournaments: ScheduleRow[];
}) {
  const weekGroups = useMemo<WeekGroup[]>(() => {
    const map = new Map<string, TournamentEntry[]>();

    for (const tournament of tournaments) {
      const key = tournament.week === null ? 'na' : String(tournament.week);

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ ...tournament, carryover: false });

      // Masters 1000 events run across 2 weeks — also list under the following week
      if (tournament.level.toLowerCase().includes('1000') && tournament.week !== null) {
        const nextKey = String(tournament.week + 1);
        if (!map.has(nextKey)) map.set(nextKey, []);
        map.get(nextKey)!.push({ ...tournament, carryover: true });
      }
    }

    return Array.from(map.entries())
      .map(([key, items]) => {
        const sortedItems = [...items].sort((a, b) => {
          const levelDiff = getLevelSortValue(b.level) - getLevelSortValue(a.level);
          if (levelDiff !== 0) return levelDiff;

          const dateDiff = getDateValue(a.start_date) - getDateValue(b.start_date);
          if (dateDiff !== 0) return dateDiff;

          return a.name.localeCompare(b.name);
        });

        const week = key === 'na' ? null : Number(key);

        // Week start date = earliest non-carryover tournament; fall back to carryover if week is all carryovers
        const ownItems = sortedItems.filter((t) => !t.carryover);
        const startDate = (ownItems.length > 0 ? ownItems : sortedItems)[0]?.start_date ?? null;

        return { key, week, tournaments: sortedItems, startDate };
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
                key={`${tournament.edition_id}${tournament.carryover ? '-c' : ''}`}
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {tournament.name}
                    {tournament.carryover && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#64748b',
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          padding: '2px 8px',
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
      ))}
    </div>
  );
}

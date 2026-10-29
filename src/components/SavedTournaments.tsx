'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import AddTournamentPicker from '@/components/AddTournamentPicker';
import { accountApi } from '@/lib/account-client';
import type { Phase, SavedItem } from '@/lib/saved-schedule';

// The Saved page's list: Current / Upcoming / Past tabs, one compact row per
// tournament, and an Edit mode that reveals the remove buttons.

const TABS: { key: Phase; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

const EMPTY: Record<Phase, string> = {
  current: 'Nothing you saved is being played this week.',
  upcoming: 'No upcoming tournaments saved.',
  past: 'No past tournaments yet.',
};

type Row = SavedItem & { label: string };

function displayName(name: string) {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function badge(start: string | null): { month: string; day: string } {
  if (!start) return { month: 'TBD', day: '–' };
  const d = new Date(`${start}T00:00:00Z`);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
    day: String(d.getUTCDate()),
  };
}

export default function SavedTournaments({
  groups,
  initialPhase,
}: {
  groups: Record<Phase, Row[]>;
  initialPhase: Phase;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const rows = groups[phase];
  const upcomingIds = groups.upcoming.map((r) => r.editionId).join(',');
  const anySaved = TABS.some((t) => groups[t.key].length > 0);
  const savedIds = TABS.flatMap((t) => groups[t.key].map((r) => r.editionId));

  async function remove(id: string) {
    setRemoving(id);
    const result = await accountApi('/api/saved', 'DELETE', { editionIds: [id] });
    setRemoving(null);
    if (result.ok) router.refresh();
  }

  return (
    <div className={`saved${editing ? ' saved--editing' : ''}`}>
      <div className="saved__bar">
        <div className="saved-tabs" role="tablist" aria-label="Saved tournaments">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={phase === t.key}
              className={`saved-tabs__tab${phase === t.key ? ' saved-tabs__tab--on' : ''}`}
              onClick={() => setPhase(t.key)}
            >
              {t.label}
              <span className="saved-tabs__count">{groups[t.key].length}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="link-button saved__edit"
          onClick={() => {
            setEditing((e) => !e);
            setPicking(false);
          }}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {(editing || !anySaved) &&
        (picking ? (
          <AddTournamentPicker savedIds={savedIds} onClose={() => setPicking(false)} />
        ) : (
          <button type="button" className="saved__add" onClick={() => setPicking(true)}>
            <span aria-hidden="true">+</span> Add tournament
          </button>
        ))}

      {rows.length === 0 ? (
        <p className="saved__empty">
          {anySaved
            ? EMPTY[phase]
            : 'Nothing saved yet. Add a tournament above, tap Save on any tournament page, or build a run in the Builder and tap Save to schedule.'}
        </p>
      ) : (
        <ul className="saved-list">
          {rows.map((r) => {
            const b = badge(r.start);
            return (
              <li key={r.editionId} className={`saved-row saved-row--${phase}`}>
                <Link href={`/tournaments/${r.slug}?year=${r.year}&from=%2Faccount`} className="saved-row__link">
                  <span className="saved-row__date" aria-hidden="true">
                    <span className="saved-row__month">{b.month}</span>
                    <span className="saved-row__day">{b.day}</span>
                  </span>
                  <span className="saved-row__body">
                    <span className="saved-row__name">{displayName(r.name)}</span>
                    <span className="saved-row__meta">
                      {r.city}
                      {r.country ? `, ${r.country}` : ''} · {r.level}
                    </span>
                  </span>
                  <span className="saved-row__when">{r.label}</span>
                </Link>
                {editing && (
                  <button
                    type="button"
                    className="saved-row__remove"
                    onClick={() => remove(r.editionId)}
                    disabled={removing === r.editionId}
                    aria-label={`Remove ${displayName(r.name)}`}
                  >
                    {removing === r.editionId ? '…' : 'Remove'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {phase === 'upcoming' && groups.upcoming.length > 0 && (
        <div className="saved__actions">
          <a href={`/schedule?build=${encodeURIComponent(upcomingIds)}&from=%2Faccount`} className="sched-btn">
            View itinerary
          </a>
          <a href={`/?build=${encodeURIComponent(upcomingIds)}`} className="sched-btn">
            Open in Builder
          </a>
        </div>
      )}
    </div>
  );
}

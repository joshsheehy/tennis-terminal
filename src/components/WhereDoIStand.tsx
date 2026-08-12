'use client';

import { useMemo, useState } from 'react';
import {
  standingsForEvents,
  describeStanding,
  type EventStanding,
} from '@/lib/entry-position';
import type { Aug17EntryList } from '@/lib/aug17-entry-lists';

// Answers the question the lists themselves do not: of the events this week,
// which one do I actually get into? Reading six tables and counting is exactly
// the work this should be doing for the player.

function outcomeColor(s: EventStanding): string {
  if (s.main.alternateNumber == null) return '#1a7f47'; // straight into the main draw
  if (s.qualifying.alternateNumber == null) return '#2c7a4b'; // qualifying place
  const alt = Math.min(
    s.main.alternateNumber ?? Infinity,
    s.qualifying.alternateNumber ?? Infinity
  );
  if (alt <= 3) return '#c2691e'; // realistic wait
  return '#8a8a8a';
}

function outcomeHeadline(s: EventStanding): string {
  if (s.main.alternateNumber == null) return 'In the main draw';
  if (s.qualifying.alternateNumber == null) return 'In qualifying';
  const alt = Math.min(
    s.main.alternateNumber ?? Infinity,
    s.qualifying.alternateNumber ?? Infinity
  );
  const where = (s.main.alternateNumber ?? Infinity) <= (s.qualifying.alternateNumber ?? Infinity)
    ? 'main draw'
    : 'qualifying';
  if (alt <= 3) return `${where} ALT ${alt} — realistic`;
  return `${where} ALT ${alt} — unlikely`;
}

export default function WhereDoIStand({ events }: { events: Aug17EntryList[] }) {
  const [value, setValue] = useState('');
  const rank = Number(value);
  const valid = Number.isFinite(rank) && rank > 0 && value.trim() !== '';

  const standings = useMemo(
    () => (valid ? standingsForEvents(rank, events) : []),
    [valid, rank, events]
  );

  return (
    <section
      className="card"
      style={{ padding: 16, margin: '20px 0', display: 'block' }}
    >
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
        Where do I stand this week?
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
          placeholder="Your ranking, e.g. 250"
          style={{
            padding: '9px 12px',
            fontSize: 16,
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.4)',
            background: 'transparent',
            color: 'inherit',
            width: 200,
          }}
        />
        {valid ? (
          <span style={{ fontSize: 13, opacity: 0.7 }}>
            Best options first, across all {events.length} events
          </span>
        ) : null}
      </div>

      {valid ? (
        <ol style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
          {standings.map((s) => (
            <li
              key={s.slug}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
                alignItems: 'baseline',
                padding: '9px 0',
                borderBottom: '1px solid rgba(128,128,128,0.15)',
              }}
            >
              <div style={{ minWidth: 190 }}>
                <strong>{s.name}</strong>
                <span style={{ opacity: 0.6, fontSize: 13 }}>
                  {' '}
                  {s.level} · {s.surface}
                </span>
              </div>
              <div
                style={{ color: outcomeColor(s), fontWeight: 700, fontSize: 14, minWidth: 210 }}
              >
                {outcomeHeadline(s)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.65, minWidth: 230 }}>
                {describeStanding(s.main)} · {describeStanding(s.qualifying)}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <p style={{ fontSize: 12, opacity: 0.6, margin: '12px 0 0' }}>
        Your place if you entered at that ranking, counted against who is already on each
        list. It is a position in the queue, not a probability — how far an alternate list
        actually moves depends on withdrawals, which these snapshots do not yet measure.
      </p>
    </section>
  );
}

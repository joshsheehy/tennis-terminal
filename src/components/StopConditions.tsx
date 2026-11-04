'use client';

import { elevationText, hasAnyConditions, weatherLine, type EditionConditions } from '@/lib/conditions';
import { useImperial } from '@/lib/units';

// One itinerary stop's conditions, laid out like its cut chips: usual weather
// for the week, elevation, and the ball from the detail sheet.
export default function StopConditions({ conditions }: { conditions: EditionConditions | undefined }) {
  const imperial = useImperial();
  if (!hasAnyConditions(conditions)) return null;
  const cells: Array<[string, string]> = [
    ['Weather', weatherLine(conditions, imperial) ?? '—'],
    ['Elevation', conditions.elevation == null ? '—' : elevationText(conditions.elevation, imperial)],
    ['Balls', conditions.ball ?? '—'],
  ];
  return (
    <div className="sched-conds">
      {cells.map(([label, value]) => (
        <div key={label} className="sched-cond">
          <div className="sched-cut__label">{label}</div>
          <div className="sched-cond__val">{value}</div>
        </div>
      ))}
    </div>
  );
}

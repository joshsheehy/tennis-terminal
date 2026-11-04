'use client';

import UnitsSwitch from '@/components/UnitsSwitch';
import { elevationText, hasAnyConditions, weatherLine, type EditionConditions } from '@/lib/conditions';
import { useImperial } from '@/lib/units';

// The week's playing conditions on the Builder's info card: usual weather,
// elevation, and the ball from the detail sheet. Facts only, no commentary.
export default function ConditionsBlock({ conditions }: { conditions: EditionConditions | undefined }) {
  const imperial = useImperial();
  if (!hasAnyConditions(conditions)) return null;
  const weather = weatherLine(conditions, imperial);
  const rows: Array<[string, string]> = [];
  if (weather) rows.push(['Weather', weather]);
  if (conditions.elevation != null) rows.push(['Elevation', elevationText(conditions.elevation, imperial)]);
  rows.push(['Balls', conditions.ball ?? '—']);
  return (
    <div className="tinfo-cond">
      <div className="tinfo-cond__head">
        <p className="tinfo-label">Conditions</p>
        <UnitsSwitch />
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="tinfo-cond__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import { hasAnyConditions, weatherLine, type EditionConditions } from '@/lib/conditions';

// The week's playing conditions: usual weather (outdoor events only), elevation,
// and the ball and court brand from the detail sheet. Facts only, no commentary.
export default function ConditionsBlock({ conditions }: { conditions: EditionConditions | undefined }) {
  if (!hasAnyConditions(conditions)) return null;
  const weather = conditions.indoor ? 'Indoor' : weatherLine(conditions);
  const rows: Array<[string, string]> = [];
  if (weather) rows.push(['Weather', weather]);
  if (conditions.elevation != null) rows.push(['Elevation', `${conditions.elevation.toLocaleString('en-US')} m`]);
  rows.push(['Balls', conditions.ball ?? '—'], ['Court', conditions.court ?? '—']);
  return (
    <div className="tinfo-cond">
      <p className="tinfo-label">Conditions</p>
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

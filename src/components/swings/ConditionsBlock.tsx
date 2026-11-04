import { elevationText, hasAnyConditions, weatherLine, type EditionConditions } from '@/lib/conditions';

// The week's playing conditions: usual weather (outdoor events only), elevation,
// and the ball from the detail sheet. Facts only, no commentary. The unit
// switch is the Builder's one units setting, shared with distances.
export default function ConditionsBlock({
  conditions,
  imperial,
  onUnits,
}: {
  conditions: EditionConditions | undefined;
  imperial: boolean;
  onUnits: (imperial: boolean) => void;
}) {
  if (!hasAnyConditions(conditions)) return null;
  const weather = conditions.indoor ? 'Indoor' : weatherLine(conditions, imperial);
  const rows: Array<[string, string]> = [];
  if (weather) rows.push(['Weather', weather]);
  if (conditions.elevation != null) rows.push(['Elevation', elevationText(conditions.elevation, imperial)]);
  rows.push(['Balls', conditions.ball ?? '—']);
  return (
    <div className="tinfo-cond">
      <div className="tinfo-cond__head">
        <p className="tinfo-label">Conditions</p>
        <div className="tinfo-units" role="group" aria-label="Units">
          <button type="button" aria-pressed={!imperial} onClick={() => onUnits(false)}>
            °C · m
          </button>
          <button type="button" aria-pressed={imperial} onClick={() => onUnits(true)}>
            °F · ft
          </button>
        </div>
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

'use client';

import { setImperialPreference, useImperial } from '@/lib/units';

// °C · m / °F · ft — the site's one units setting (see src/lib/units.ts).
export default function UnitsSwitch() {
  const imperial = useImperial();
  return (
    <div className="units-switch" role="group" aria-label="Units">
      <button type="button" aria-pressed={!imperial} onClick={() => setImperialPreference(false)}>
        °C · m
      </button>
      <button type="button" aria-pressed={imperial} onClick={() => setImperialPreference(true)}>
        °F · ft
      </button>
    </div>
  );
}

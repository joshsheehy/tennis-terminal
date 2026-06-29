'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SwingMapEvent } from '@/lib/swings-page-data';
import { haversineKm } from '@/lib/swings';
import { CURRENT_SEASON } from '@/lib/seasons';
import {
  fridayBefore,
  formatTravelDate,
  googleFlightsUrl,
  placeLabel,
} from '@/lib/itinerary';
import '../../app/swings/swings.css';

// US + the two other non-metric countries — mirrors SwingsView so distances
// read in the viewer's units.
function detectImperial(): boolean {
  if (typeof navigator === 'undefined') return false;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => {
    try {
      const region = new Intl.Locale(l).maximize().region;
      return region === 'US' || region === 'LR' || region === 'MM';
    } catch {
      return /-(US|LR|MM)\b/i.test(l);
    }
  });
}

function formatDistance(km: number, imperial: boolean): string {
  return imperial ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
}

export default function ItineraryView({
  stops,
  year,
}: {
  stops: SwingMapEvent[];
  year: number;
}) {
  const [imperial, setImperial] = useState(false);
  useEffect(() => setImperial(detectImperial()), []);

  const builderHref = `/?build=${stops.map((s) => s.editionId).join(',')}${
    year !== CURRENT_SEASON ? `&year=${year}` : ''
  }`;

  const surfaces = Array.from(new Set(stops.map((s) => s.surface)));
  const first = stops[0];
  const last = stops[stops.length - 1];
  const dateRange =
    stops.length > 1
      ? `${formatTravelDate(first.startDate)} – ${formatTravelDate(last.startDate)}`
      : formatTravelDate(first.startDate);

  return (
    <main className="itin-root">
      <div className="itin-head">
        <Link className="itin-back" href={builderHref}>
          ← Edit swing
        </Link>
        <h1 className="itin-title">Your swing</h1>
        <p className="itin-sub">
          {stops.length} stop{stops.length > 1 ? 's' : ''} · {dateRange} · {surfaces.join(' / ')}
        </p>
      </div>

      <ol className="itin-list">
        {stops.map((s, i) => {
          const next = stops[i + 1];
          const travelDate = next ? fridayBefore(next.startDate) : null;
          const legKm =
            next != null
              ? haversineKm(s.latitude, s.longitude, next.latitude, next.longitude)
              : null;
          return (
            <Fragment key={s.editionId}>
              <li className="itin-stop">
                <div className="itin-stop-num">{i + 1}</div>
                <div className="itin-stop-body">
                  <div className="itin-stop-week">
                    Week {s.week} · {formatTravelDate(s.startDate)}
                  </div>
                  <Link className="itin-stop-name" href={`/tournaments/${s.slug}`}>
                    {s.name}
                  </Link>
                  <div className="itin-stop-meta">
                    {placeLabel(s.city, s.country)} · {s.level} · {s.surface}
                  </div>
                </div>
              </li>

              {next && (
                <li className="itin-leg">
                  <div className="itin-leg-route">
                    {s.city} <span className="itin-leg-arrow">→</span> {next.city}
                  </div>
                  <div className="itin-leg-meta">
                    {travelDate ? formatTravelDate(travelDate) : 'travel between stops'}
                    {legKm != null && ` · ${formatDistance(legKm, imperial)}`}
                  </div>
                  <div className="itin-leg-links">
                    <a
                      className="itin-flight-btn"
                      href={googleFlightsUrl(
                        placeLabel(s.city, s.country),
                        placeLabel(next.city, next.country),
                        travelDate
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Flights ↗
                    </a>
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </main>
  );
}

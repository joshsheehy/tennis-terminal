'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { SwingMapEvent, SwingMapSwing } from '@/lib/swings-page-data';
import type { CandidateTier } from '@/lib/swing-builder';

const ACCENT = '#38bdf8';
const ACCENT_DIM = 'rgba(56,189,248,0.5)';
const SERIES = '#fbbf24';
const GRAY = '#64748b';

// Candidate colors in build mode, by relationship tier.
const TIER_COLOR: Record<CandidateTier, string> = {
  'same-city': '#22c55e',
  'same-country': '#22c55e',
  neighbor: '#fbbf24',
  'same-region': '#38bdf8',
  far: '#94a3b8',
};

export type MapEvent = SwingMapEvent & {
  dim: boolean;
  /** Builder annotations (only set in build mode). */
  builderRole?: 'chain' | 'candidate';
  chainPos?: number;
  tier?: CandidateTier;
  /** Entry-status tint for a chain dot once a ranking is entered. */
  statusColor?: string;
};

type Props = {
  events: MapEvent[];
  swings: SwingMapSwing[];
  /** Swing indexes whose chains should be drawn (intersect the window). */
  visibleSwingIndexes: number[];
  selectedSwingIndex: number | null;
  onSelectSwing: (index: number | null) => void;
  initialCenter: [number, number];
  initialZoom: number;
  /** Points to frame; the map re-fits whenever fitNonce changes. */
  fitPoints: [number, number][];
  fitNonce: number;
  /** Build mode: render only chain + candidates; tapping an event picks it. */
  builderActive: boolean;
  builderPath: [number, number][];
  onPickEvent: (editionId: string) => void;
};

export default function SwingsMap({
  events,
  swings,
  visibleSwingIndexes,
  selectedSwingIndex,
  onSelectSwing,
  initialCenter,
  initialZoom,
  fitPoints,
  fitNonce,
  builderActive,
  builderPath,
  onPickEvent,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectSwing);
  onSelectRef.current = onSelectSwing;
  const onPickRef = useRef(onPickEvent);
  onPickRef.current = onPickEvent;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: true,
      });
      L.control.zoom({ position: 'topright' }).addTo(map);
      // CARTO Voyager: OSM-derived tiles that render place labels in Latin
      // script (romanized), so the map reads in English worldwide rather than
      // each country's local language/script.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(map);
      // Map sits inside a flex pane that sizes after paint; nudge Leaflet.
      setTimeout(() => map.invalidateSize(), 0);

      mapRef.current = map;
      layersRef.current = L.layerGroup().addTo(map);
      renderLayers(L);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw markers + chains whenever inputs change.
  useEffect(() => {
    (async () => {
      const L = (await import('leaflet')).default;
      renderLayers(L);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, visibleSwingIndexes, selectedSwingIndex, builderActive, builderPath]);

  // Re-frame the map when the focus set changes (e.g. a new week is picked).
  useEffect(() => {
    (async () => {
      const L = (await import('leaflet')).default;
      const map = mapRef.current;
      if (!map || fitPoints.length === 0) return;
      if (fitPoints.length === 1) {
        map.setView(fitPoints[0], Math.max(map.getZoom(), 5), { animate: true });
        return;
      }
      map.fitBounds(L.latLngBounds(fitPoints), { padding: [48, 48], maxZoom: 7, animate: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderLayers(L: any) {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (builderActive) {
      renderBuilderLayers(L, layers);
      return;
    }

    // Chains first so dots sit on top (series have no polyline).
    for (const index of visibleSwingIndexes) {
      const swing = swings[index];
      if (!swing || swing.kind !== 'swing' || swing.path.length < 2) continue;
      const selected = index === selectedSwingIndex;
      L.polyline(
        swing.path.map((p) => [p.lat, p.lng]),
        {
          color: ACCENT,
          weight: selected ? 5 : 3,
          opacity: selected ? 0.95 : 0.6,
          dashArray: selected ? undefined : '4 6',
        }
      )
        .on('click', () => onSelectRef.current(index))
        .addTo(layers);
    }

    // One amber marker per visible series (single city; no travel chain).
    for (const index of visibleSwingIndexes) {
      const swing = swings[index];
      if (!swing || swing.kind !== 'series' || swing.path.length === 0) continue;
      const selected = index === selectedSwingIndex;
      const size = selected ? 34 : 28;
      const icon = L.divIcon({
        className: 'swing-dot-icon',
        html: `<div class="series-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:${SERIES};width:${size}px;height:${size}px">${swing.totalWeeks}w</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker([swing.path[0].lat, swing.path[0].lng], { icon, zIndexOffset: selected ? 1000 : 0 })
        .on('click', () => onSelectRef.current(index))
        .bindPopup(`<div class="swing-popup"><strong>${swing.label}</strong><div class="swing-popup__meta">W${swing.startWeek}–W${swing.endWeek} · ${swing.totalWeeks} weeks · same city</div></div>`)
        .addTo(layers);
    }

    for (const event of events) {
      // Series members are represented by the single series marker above.
      if (event.swingIndex != null && swings[event.swingIndex]?.kind === 'series') continue;
      const inSwing = event.swingIndex != null;
      const selected = inSwing && event.swingIndex === selectedSwingIndex;

      if (inSwing) {
        const color = event.dim && !selected ? ACCENT_DIM : ACCENT;
        const size = selected ? 32 : 26;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="swing-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:${color};width:${size}px;height:${size}px;opacity:${event.dim && !selected ? 0.55 : 1}">${event.week}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        L.marker([event.latitude, event.longitude], { icon, zIndexOffset: selected ? 1000 : 0 })
          .on('click', () => onSelectRef.current(event.swingIndex))
          .bindPopup(popupHtml(event))
          .addTo(layers);
      } else {
        L.circleMarker([event.latitude, event.longitude], {
          radius: 5,
          color: GRAY,
          weight: 1,
          fillColor: GRAY,
          fillOpacity: event.dim ? 0.3 : 0.6,
          opacity: event.dim ? 0.4 : 0.8,
        })
          .bindPopup(popupHtml(event))
          .addTo(layers);
      }
    }
  }

  // Build mode: bright numbered chain + polyline, plus tier-colored, tappable
  // candidate dots. Nothing else is drawn, which keeps the map uncluttered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderBuilderLayers(L: any, layers: any) {
    if (builderPath.length >= 2) {
      L.polyline(builderPath, { color: ACCENT, weight: 5, opacity: 0.95 }).addTo(layers);
    }

    for (const event of events) {
      if (event.builderRole === 'chain') {
        const size = 30;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="swing-dot" style="--dot:${event.statusColor ?? ACCENT};width:${size}px;height:${size}px">${event.chainPos}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        L.marker([event.latitude, event.longitude], { icon, zIndexOffset: 1000 })
          .bindPopup(popupHtml(event))
          .addTo(layers);
      } else {
        const color = event.tier ? TIER_COLOR[event.tier] : ACCENT;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="cand-dot" style="--dot:${color}">${event.week}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([event.latitude, event.longitude], { icon })
          .on('click', () => onPickRef.current(event.editionId))
          .bindPopup(popupHtml(event, true))
          .addTo(layers);
      }
    }
  }

  return <div ref={containerRef} className="swings-map" />;
}

function popupHtml(event: MapEvent, isCandidate = false): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const hint = isCandidate ? '<div class="swing-popup__hint">Tap the dot to add to your swing</div>' : '';
  return `
    <div class="swing-popup">
      <strong>${esc(event.name)}</strong>
      <div class="swing-popup__meta">${esc(event.city)}${event.country ? `, ${esc(event.country)}` : ''}</div>
      <div class="swing-popup__meta">W${event.week} · ${esc(event.level)} · ${esc(event.surface)}</div>
      ${hint}
      <a class="swing-popup__link" href="/tournaments/${esc(event.slug)}">View tournament →</a>
    </div>`;
}

'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { SwingMapEvent, SwingMapSwing } from '@/lib/swings-page-data';

const ACCENT = '#38bdf8';
const ACCENT_DIM = 'rgba(56,189,248,0.5)';
const GRAY = '#64748b';

export type MapEvent = SwingMapEvent & { dim: boolean };

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectSwing);
  onSelectRef.current = onSelectSwing;

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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
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
  }, [events, visibleSwingIndexes, selectedSwingIndex]);

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

    // Chains first so dots sit on top.
    for (const index of visibleSwingIndexes) {
      const swing = swings[index];
      if (!swing || swing.path.length < 2) continue;
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

    for (const event of events) {
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

  return <div ref={containerRef} className="swings-map" />;
}

function popupHtml(event: MapEvent): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `
    <div class="swing-popup">
      <strong>${esc(event.name)}</strong>
      <div class="swing-popup__meta">${esc(event.city)}${event.country ? `, ${esc(event.country)}` : ''}</div>
      <div class="swing-popup__meta">W${event.week} · ${esc(event.level)} · ${esc(event.surface)}</div>
      <a class="swing-popup__link" href="/tournaments/${esc(event.slug)}">View tournament →</a>
    </div>`;
}

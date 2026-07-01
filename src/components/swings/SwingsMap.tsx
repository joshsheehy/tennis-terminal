'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup, TileLayer } from 'leaflet';
import type { SwingMapEvent, SwingMapSwing } from '@/lib/swings-page-data';
import type { CandidateTier } from '@/lib/swing-builder';

// Route lines use the brand green so a swing reads as "your trip".
const ROUTE = '#3CB043';
const ROUTE_DIM = 'rgba(60, 176, 67, 0.55)';

// Candidate colors in build mode, by relationship tier.
const TIER_COLOR: Record<CandidateTier, string> = {
  'same-city': '#22c55e',
  'same-country': '#22c55e',
  neighbor: '#fbbf24',
  'same-region': '#38bdf8',
  far: '#94a3b8',
};

// CARTO basemaps (OSM-derived, Latin/romanized labels worldwide). The pair is
// theme-matched: Positron for light UI, Dark Matter for dark UI.
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// Marker color/size by event level, matching the level-badge palette used on
// the schedule (Grand Slam purple, ATP blue, Challenger amber, ITF slate).
// These sit on map tiles (not themed surfaces), so fixed hex values work for
// both themes.
function levelStyle(event: SwingMapEvent): { color: string; text: string; size: number } {
  if (/grand slam/i.test(event.level)) return { color: '#8b5cf6', text: '#ffffff', size: 34 };
  if (event.group === 'atp') return { color: '#3b82f6', text: '#ffffff', size: 30 };
  if (event.group === 'challenger') return { color: '#f59e0b', text: '#422006', size: 26 };
  return { color: '#64748b', text: '#ffffff', size: 22 };
}

function levelBadgeClass(event: SwingMapEvent): string {
  if (/grand slam/i.test(event.level)) return 'badge-level badge-level--gs';
  if (event.group === 'atp') return 'badge-level badge-level--atp';
  if (event.group === 'challenger') return 'badge-level badge-level--ch';
  return 'badge-level';
}

function surfaceDotClass(surface: string): string {
  const s = (surface === 'Indoor Hard' ? 'Hard' : surface).toLowerCase();
  if (s === 'hard') return 'surface-dot surface-dot--hard';
  if (s === 'clay') return 'surface-dot surface-dot--clay';
  if (s === 'grass') return 'surface-dot surface-dot--grass';
  return 'surface-dot';
}

// Quadratic-bezier arc between two points, bowed perpendicular to the segment.
// Purely visual (not geodesic) — it makes an itinerary read as a journey
// rather than a wire polygon.
function arcPoints(
  a: [number, number],
  b: [number, number],
  curvature = 0.18,
  steps = 24
): [number, number][] {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const cLat = (lat1 + lat2) / 2 - dLng * curvature;
  const cLng = (lng1 + lng2) / 2 + dLat * curvature;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * lat1 + 2 * u * t * cLat + t * t * lat2,
      u * u * lng1 + 2 * u * t * cLng + t * t * lng2,
    ]);
  }
  return pts;
}

function arcPath(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(...arcPoints(points[i], points[i + 1]));
  }
  return out;
}

// Tracks the effective theme (data-theme attribute, falling back to the OS
// preference) so the map can swap tile sets in step with the UI.
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const compute = () => {
      const attr = root.getAttribute('data-theme');
      setDark(attr === 'dark' || (attr !== 'light' && mq.matches));
    };
    compute();
    const mo = new MutationObserver(compute);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener('change', compute);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', compute);
    };
  }, []);
  return dark;
}

export type MapEvent = SwingMapEvent & {
  dim: boolean;
  /** Builder annotations (only set in build mode). */
  builderRole?: 'chain' | 'candidate';
  chainPos?: number;
  tier?: CandidateTier;
  /** Entry-status tint for a chain dot once a ranking is entered. */
  statusColor?: string;
  /** Pre-formatted reference-cut line for the popup (e.g. "2025 cut · MD #245 · Q #390"). */
  cutText?: string;
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
  const tileRef = useRef<TileLayer | null>(null);
  const onSelectRef = useRef(onSelectSwing);
  onSelectRef.current = onSelectSwing;
  const onPickRef = useRef(onPickEvent);
  onPickRef.current = onPickEvent;
  const isDark = useIsDark();
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

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
        attributionControl: false,
        worldCopyJump: true,
      });
      // Controls live bottom-left so the floating filter/timeline cluster
      // (top) and the itinerary panel (right, desktop) never cover them.
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      L.control
        .attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('&copy; OpenStreetMap &copy; CARTO')
        .addTo(map);
      tileRef.current = L.tileLayer(isDarkRef.current ? TILE_DARK : TILE_LIGHT, {
        maxZoom: 20,
        subdomains: 'abcd',
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
      tileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap tile sets when the theme flips.
  useEffect(() => {
    tileRef.current?.setUrl(isDark ? TILE_DARK : TILE_LIGHT);
  }, [isDark]);

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
        arcPath(swing.path.map((p) => [p.lat, p.lng] as [number, number])),
        {
          color: selected ? ROUTE : ROUTE_DIM,
          weight: selected ? 4 : 3,
          opacity: selected ? 0.95 : 0.65,
          dashArray: selected ? undefined : '6 8',
          lineCap: 'round',
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
        html: `<div class="series-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:#fbbf24;width:${size}px;height:${size}px">${swing.totalWeeks}w</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker([swing.path[0].lat, swing.path[0].lng], { icon, zIndexOffset: selected ? 1000 : 0 })
        .on('click', () => onSelectRef.current(index))
        .bindPopup(`<div class="swing-popup"><div class="swing-popup__name">${swing.label}</div><div class="swing-popup__meta">W${swing.startWeek}–W${swing.endWeek} · ${swing.totalWeeks} weeks · same city</div></div>`)
        .addTo(layers);
    }

    for (const event of events) {
      // Series members are represented by the single series marker above.
      if (event.swingIndex != null && swings[event.swingIndex]?.kind === 'series') continue;
      const inSwing = event.swingIndex != null;
      const selected = inSwing && event.swingIndex === selectedSwingIndex;
      const style = levelStyle(event);

      if (inSwing) {
        const size = selected ? style.size + 4 : style.size;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="swing-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:${style.color};--dot-text:${style.text};width:${size}px;height:${size}px;opacity:${event.dim && !selected ? 0.5 : 1}">${event.week}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        L.marker([event.latitude, event.longitude], { icon, zIndexOffset: selected ? 1000 : 0 })
          .on('click', () => onSelectRef.current(event.swingIndex))
          .bindPopup(popupHtml(event))
          .addTo(layers);
      } else {
        L.circleMarker([event.latitude, event.longitude], {
          radius: Math.max(4, style.size / 5),
          color: '#ffffff',
          weight: 1.5,
          fillColor: style.color,
          fillOpacity: event.dim ? 0.35 : 0.85,
          opacity: event.dim ? 0.4 : 0.9,
        })
          .bindPopup(popupHtml(event))
          .addTo(layers);
      }
    }
  }

  // Build mode: numbered chain stops joined by a dashed brand-green arc, plus
  // tier-colored, tappable candidate dots. Nothing else is drawn, which keeps
  // the map uncluttered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderBuilderLayers(L: any, layers: any) {
    if (builderPath.length >= 2) {
      L.polyline(arcPath(builderPath), {
        color: ROUTE,
        weight: 3.5,
        opacity: 0.9,
        dashArray: '7 9',
        lineCap: 'round',
      }).addTo(layers);
    }

    for (const event of events) {
      if (event.builderRole === 'chain') {
        const size = 30;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="swing-dot" style="--dot:${event.statusColor ?? ROUTE};--dot-text:#ffffff;width:${size}px;height:${size}px">${event.chainPos}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        L.marker([event.latitude, event.longitude], { icon, zIndexOffset: 1000 })
          .bindPopup(popupHtml(event))
          .addTo(layers);
      } else {
        const color = event.tier ? TIER_COLOR[event.tier] : ROUTE;
        const icon = L.divIcon({
          className: 'swing-dot-icon',
          html: `<div class="cand-dot" style="--dot:${color}">${event.week}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        // Tapping the dot only opens the popup so you can read the tournament
        // first; adding to the swing is an explicit button inside the popup.
        const marker = L.marker([event.latitude, event.longitude], { icon })
          .bindPopup(popupHtml(event, true))
          .addTo(layers);
        marker.on('popupopen', (e: { popup: { getElement(): HTMLElement | null } }) => {
          const btn = e.popup.getElement()?.querySelector('.swing-popup__add');
          btn?.addEventListener('click', () => {
            onPickRef.current(event.editionId);
            mapRef.current?.closePopup();
          });
        });
      }
    }
  }

  return <div ref={containerRef} className="swings-map" />;
}

function popupHtml(event: MapEvent, isCandidate = false): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const cutLine = event.cutText
    ? `<div class="swing-popup__cut">${esc(event.cutText)}</div>`
    : '';
  const addButton = isCandidate
    ? '<button type="button" class="swing-popup__add">+ Add to swing</button>'
    : '';
  return `
    <div class="swing-popup">
      <div class="swing-popup__name">${esc(event.name)}</div>
      <div class="swing-popup__meta">${esc(event.city)}${event.country ? `, ${esc(event.country)}` : ''} · Week ${event.week}</div>
      <div class="swing-popup__badges">
        <span class="${levelBadgeClass(event)}">${esc(event.level)}</span>
        <span class="badge-surface"><span class="${surfaceDotClass(event.surface)}"></span>${esc(event.surface)}</span>
      </div>
      ${cutLine}
      ${addButton}
      <a class="swing-popup__link" href="/tournaments/${esc(event.slug)}">View tournament →</a>
    </div>`;
}

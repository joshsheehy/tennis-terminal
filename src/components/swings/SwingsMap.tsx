'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup } from 'maplibre-gl';
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

// OpenFreeMap: OpenStreetMap-derived vector tiles, free, with no API key and no
// rate limit. CARTO moved its free raster basemaps behind a signup and began
// serving tiles stamped "API KEY REQUIRED" instead of failing, so the map still
// drew — covered in watermarks. These styles are theme-matched: Positron for
// light UI, the dark build for dark.
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

const ROUTE_SOURCE = 'swing-routes';
const ROUTE_LAYER_SOLID = 'swing-routes-solid';
const ROUTE_LAYER_DASHED = 'swing-routes-dashed';

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

/** GeoJSON wants [lng, lat]; everything upstream speaks [lat, lng]. */
function toLngLat(points: [number, number][]): [number, number][] {
  return points.map(([lat, lng]) => [lng, lat]);
}

// Tracks the effective theme (data-theme attribute, falling back to the OS
// preference) so the map can swap styles in step with the UI.
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
  /** Candidate in a week that already has a stop: its popup offers no Add button. */
  addLocked?: boolean;
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

type RouteProps = { swingIndex: number; selected: boolean };
type RouteFeature = GeoJSON.Feature<GeoJSON.LineString, RouteProps>;

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
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const openPopupRef = useRef<MapLibrePopup | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlRef = useRef<any>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelectSwing);
  onSelectRef.current = onSelectSwing;
  const onPickRef = useRef(onPickEvent);
  onPickRef.current = onPickEvent;
  const isDark = useIsDark();
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  // The newest draw closure, so handlers registered once can still call it.
  const drawRef = useRef<() => void>(() => {});

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = await import('maplibre-gl');
      if (cancelled || !containerRef.current || mapRef.current) return;
      mlRef.current = maplibregl;

      // MapLibre works out its own worker URL from `import.meta.url`, which
      // webpack rewrites when it bundles. The check it runs on that value then
      // fails, the URL comes back empty, and the worker is never created — with
      // no error. The map mounts, reports a loaded style, and quietly requests
      // no tiles at all, which draws as a blank world. Point it at the copy
      // scripts/copy-maplibre-worker.mjs puts in public/ instead.
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: isDarkRef.current ? STYLE_DARK : STYLE_LIGHT,
        center: [initialCenter[1], initialCenter[0]],
        zoom: initialZoom,
        attributionControl: false,
        maxPitch: 75,
      });

      // Controls live bottom-left so the floating filter/timeline cluster
      // (top) and the itinerary panel (right, desktop) never cover them.
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
        'bottom-left'
      );
      map.addControl(
        new maplibregl.AttributionControl({
          compact: false,
          customAttribution: '&copy; OpenStreetMap &copy; OpenFreeMap',
        }),
        'bottom-left'
      );

      mapRef.current = map;
      map.once('load', () => fitRef.current());

      // A style swap drops every source and layer we added, so the route
      // layers are installed on each style load rather than once at startup.
      map.on('style.load', () => {
        // The tour is a global object, so the map is one too: a sphere you can
        // spin and tilt, rather than a flattened rectangle where a Tokyo to
        // Santiago leg runs off one edge and back on the other. Set per style
        // load, since a style carries its own projection.
        map.setProjection({ type: 'globe' });
        applyLatinLabels(map);
        if (isDarkRef.current) applyDarkTint(map);
        installRouteLayers(map);
        map.setSky({
          'sky-color': isDarkRef.current ? '#151412' : '#9ec3e8',
          'sky-horizon-blend': 0.5,
          'horizon-color': isDarkRef.current ? '#24231f' : '#e8f0f8',
          'horizon-fog-blend': 0.6,
          'fog-color': isDarkRef.current ? '#151412' : '#dbe6f0',
          'fog-ground-blend': 0.02,
        });
        readyRef.current = true;
        drawRef.current();
      });
    })();
    return () => {
      cancelled = true;
      readyRef.current = false;
      openPopupRef.current?.remove();
      openPopupRef.current = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap styles when the theme flips. Markers are DOM elements and survive it;
  // the route layers are rebuilt by the style.load handler above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    readyRef.current = false;
    map.setStyle(isDark ? STYLE_DARK : STYLE_LIGHT);
  }, [isDark]);

  // Redraw markers + chains whenever inputs change.
  useEffect(() => {
    drawRef.current = draw;
    if (readyRef.current) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, swings, visibleSwingIndexes, selectedSwingIndex, builderActive, builderPath]);

  // Re-frame the map on the current focus set. Kept in a ref so the map's own
  // 'load' handler can run it too: maplibre loads asynchronously, so the first
  // fit request usually arrives before the map exists and would be lost.
  const fitRef = useRef<() => void>(() => {});
  fitRef.current = () => {
    const map = mapRef.current;
    const maplibregl = mlRef.current;
    if (!map || !maplibregl || fitPoints.length === 0) return;
    if (fitPoints.length === 1) {
      map.easeTo({ center: [fitPoints[0][1], fitPoints[0][0]], zoom: Math.max(map.getZoom(), 5) });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const [lat, lng] of fitPoints) bounds.extend([lng, lat]);
    // On phones the bottom sheet covers roughly the lower half of the map and
    // the filters + calendar float over the top, so frame the points in the
    // part of the map that's actually visible.
    // Measure what actually covers the map rather than guessing.
    const box = map.getContainer();
    const area = box.getBoundingClientRect();
    const floatEl = document.querySelector('.swings-float');
    const sheetEl = document.querySelector('.sheet');
    const top = floatEl ? Math.max(0, floatEl.getBoundingClientRect().bottom - area.top) + 24 : 56;
    const bottom = sheetEl ? Math.max(0, area.bottom - sheetEl.getBoundingClientRect().top) + 24 : 56;
    // (Short screens, e.g. landscape, can't fit those margins; use a plain one.)
    const phone = box.clientWidth < 900 && top + bottom < area.height - 120;
    const padding = phone ? { top, bottom, left: 40, right: 40 } : 56;
    map.fitBounds(bounds, { padding, maxZoom: 7 });
  };

  // Re-frame when the focus set changes (e.g. a new week is picked).
  useEffect(() => {
    fitRef.current();
  }, [fitNonce]);

  /**
   * Render place names in English, falling back to Latin script.
   *
   * OpenMapTiles ships each label in the local language and stacks a
   * romanization under it, so the default style prints "Morocco" over "المغرب"
   * and Tokyo in kanji. The previous basemap was chosen specifically so the map
   * read in English worldwide; this keeps that, dropping to the romanized name
   * and then the local one where no English exists.
   */
  function applyLatinLabels(map: MapLibreMap) {
    for (const layer of map.getStyle()?.layers ?? []) {
      if (layer.type !== 'symbol') continue;
      const field = (layer.layout as { 'text-field'?: unknown } | undefined)?.['text-field'];
      if (field === undefined) continue;
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name:en'],
        ['get', 'name:latin'],
        ['get', 'name'],
      ]);
    }
  }

  /**
   * Lift the dark basemap toward the site's charcoal palette.
   *
   * The stock dark build is near-black land on near-black water with dim
   * borders, so countries and coastlines were hard to make out. This repaints
   * land, water, borders and place labels in lighter warm grays; layers the
   * style doesn't have are skipped.
   */
  function applyDarkTint(map: MapLibreMap) {
    const set = (id: string, prop: Parameters<MapLibreMap['setPaintProperty']>[1], value: string) => {
      if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
    };
    set('background', 'background-color', '#35332f');
    set('water', 'fill-color', '#1e1e1d');
    set('waterway', 'line-color', '#1e1e1d');
    for (const id of ['landcover_wood', 'landuse_park', 'landuse_residential', 'landcover_glacier', 'landcover_ice_shelf']) {
      set(id, 'fill-color', '#3b3935');
    }
    set('boundary_country_z0-4', 'line-color', '#77736b');
    set('boundary_country_z5-', 'line-color', '#77736b');
    set('boundary_state', 'line-color', '#4f4c47');
    for (const layer of map.getStyle()?.layers ?? []) {
      if (!layer.id.startsWith('place_') && layer.id !== 'water_name') continue;
      set(layer.id, 'text-color', '#cbc6bd');
      set(layer.id, 'text-halo-color', '#1c1b19');
    }
  }

  function installRouteLayers(map: MapLibreMap) {
    if (map.getSource(ROUTE_SOURCE)) return;
    map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    // Two layers rather than one: a dash pattern cannot be driven from feature
    // data, and the selected route is solid while the rest stay dashed.
    map.addLayer({
      id: ROUTE_LAYER_DASHED,
      type: 'line',
      source: ROUTE_SOURCE,
      filter: ['==', ['get', 'selected'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_DIM,
        'line-width': 3,
        'line-opacity': 0.65,
        'line-dasharray': [2, 2.6],
      },
    });
    map.addLayer({
      id: ROUTE_LAYER_SOLID,
      type: 'line',
      source: ROUTE_SOURCE,
      filter: ['==', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE, 'line-width': 4, 'line-opacity': 0.95 },
    });

    for (const layer of [ROUTE_LAYER_DASHED, ROUTE_LAYER_SOLID]) {
      map.on('click', layer, (e) => {
        const index = e.features?.[0]?.properties?.swingIndex;
        if (typeof index === 'number' && index >= 0) onSelectRef.current(index);
      });
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    }
  }

  function setRoutes(features: RouteFeature[]) {
    const source = mapRef.current?.getSource(ROUTE_SOURCE);
    if (!source || !('setData' in source)) return;
    (source as { setData: (data: GeoJSON.FeatureCollection) => void }).setData({
      type: 'FeatureCollection',
      features,
    });
  }

  /**
   * Open a popup on the MAP rather than on the marker.
   *
   * A marker-owned popup dies with its marker, and clicking a swing dot
   * selects that swing — which re-renders, tears down every marker, and took
   * the popup that had just opened with it. The dot appeared to do nothing.
   * Map-owned popups outlive the redraw, which is also how the Leaflet version
   * behaved.
   */
  function openPopup(lng: number, lat: number, html: string, onOpen?: (el: HTMLElement) => void) {
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!maplibregl || !map) return;
    openPopupRef.current?.remove();
    const popup = new maplibregl.Popup({
      offset: 16,
      closeButton: true,
      closeOnClick: true,
      maxWidth: '280px',
    })
      .setLngLat([lng, lat])
      .setHTML(html)
      .addTo(map);
    openPopupRef.current = popup;
    const element = popup.getElement();
    // "View tournament →" returns here (with the built schedule, which lives in
    // the URL) rather than to the tournament page's default /cuts.
    const here = `${window.location.pathname}${window.location.search}`;
    (element as HTMLElement | undefined)?.querySelectorAll('a.swing-popup__link').forEach((a: Element) => {
      const url = new URL(a.getAttribute('href') ?? '', window.location.origin);
      url.searchParams.set('from', here);
      a.setAttribute('href', `${url.pathname}${url.search}`);
    });
    if (element && onOpen) onOpen(element);
  }

  /**
   * A marker whose content is our own HTML, so every dot keeps the styling it
   * had before.
   */
  function addMarker(
    lat: number,
    lng: number,
    html: string,
    options: {
      popupHtml?: string;
      onClick?: () => void;
      onPopupOpen?: (element: HTMLElement) => void;
    } = {}
  ) {
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!maplibregl || !map) return;

    const element = document.createElement('div');
    element.className = 'swing-dot-icon';
    element.innerHTML = html;

    const marker = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);

    if (options.popupHtml || options.onClick) {
      element.addEventListener('click', (event) => {
        // Keep the click off the canvas, or closeOnClick shuts the popup in
        // the same gesture that opened it.
        event.stopPropagation();
        if (options.popupHtml) openPopup(lng, lat, options.popupHtml, options.onPopupOpen);
        options.onClick?.();
      });
    }

    markersRef.current.push(marker);
  }

  function draw() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (builderActive) {
      drawBuilder();
      return;
    }

    const routes: RouteFeature[] = [];
    for (const index of visibleSwingIndexes) {
      const swing = swings[index];
      if (!swing || swing.kind !== 'swing' || swing.path.length < 2) continue;
      routes.push({
        type: 'Feature',
        properties: { swingIndex: index, selected: index === selectedSwingIndex },
        geometry: {
          type: 'LineString',
          coordinates: toLngLat(arcPath(swing.path.map((p) => [p.lat, p.lng] as [number, number]))),
        },
      });
    }
    setRoutes(routes);

    // One amber marker per visible series (single city; no travel chain).
    for (const index of visibleSwingIndexes) {
      const swing = swings[index];
      if (!swing || swing.kind !== 'series' || swing.path.length === 0) continue;
      const selected = index === selectedSwingIndex;
      const size = selected ? 34 : 28;
      addMarker(
        swing.path[0].lat,
        swing.path[0].lng,
        `<div class="series-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:#fbbf24;width:${size}px;height:${size}px">${swing.totalWeeks}w</div>`,
        {
          onClick: () => onSelectRef.current(index),
          popupHtml: `<div class="swing-popup"><div class="swing-popup__name">${swing.label}</div><div class="swing-popup__meta">W${swing.startWeek}–W${swing.endWeek} · ${swing.totalWeeks} weeks · same city</div></div>`,
        }
      );
    }

    for (const event of events) {
      // Series members are represented by the single series marker above.
      if (event.swingIndex != null && swings[event.swingIndex]?.kind === 'series') continue;
      const inSwing = event.swingIndex != null;
      const selected = inSwing && event.swingIndex === selectedSwingIndex;
      const style = levelStyle(event);

      if (inSwing) {
        const size = selected ? style.size + 4 : style.size;
        addMarker(
          event.latitude,
          event.longitude,
          `<div class="swing-dot${selected ? ' swing-dot--selected' : ''}" style="--dot:${style.color};--dot-text:${style.text};width:${size}px;height:${size}px;opacity:${event.dim && !selected ? 0.5 : 1}">${event.week}</div>`,
          { onClick: () => onSelectRef.current(event.swingIndex), popupHtml: popupHtml(event) }
        );
      } else {
        // Previously a Leaflet circleMarker; the same plain dot is now a small
        // styled div, so every marker takes one code path.
        const size = Math.max(9, Math.round(style.size / 2.5));
        addMarker(
          event.latitude,
          event.longitude,
          `<div class="plain-dot" style="--dot:${style.color};width:${size}px;height:${size}px;opacity:${event.dim ? 0.45 : 0.9}"></div>`,
          { popupHtml: popupHtml(event) }
        );
      }
    }
  }

  // Build mode: numbered chain stops joined by a dashed brand-green arc, plus
  // tier-colored, tappable candidate dots. Nothing else is drawn, which keeps
  // the map uncluttered.
  function drawBuilder() {
    setRoutes(
      builderPath.length >= 2
        ? [
            {
              type: 'Feature',
              properties: { swingIndex: -1, selected: true },
              geometry: { type: 'LineString', coordinates: toLngLat(arcPath(builderPath)) },
            },
          ]
        : []
    );

    for (const event of events) {
      if (event.builderRole === 'chain') {
        addMarker(
          event.latitude,
          event.longitude,
          `<div class="swing-dot" style="--dot:${event.statusColor ?? ROUTE};--dot-text:#ffffff;width:30px;height:30px">${event.chainPos}</div>`,
          { popupHtml: popupHtml(event) }
        );
      } else {
        const color = event.tier ? TIER_COLOR[event.tier] : ROUTE;
        // Tapping the dot only opens the popup so you can read the tournament
        // first; adding to the swing is an explicit button inside the popup.
        addMarker(
          event.latitude,
          event.longitude,
          `<div class="cand-dot" style="--dot:${color}">${event.week}</div>`,
          {
            popupHtml: popupHtml(event, !event.addLocked),
            onPopupOpen: (element) => {
              element.querySelector('.swing-popup__add')?.addEventListener('click', () => {
                onPickRef.current(event.editionId);
                openPopupRef.current?.remove();
              });
            },
          }
        );
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

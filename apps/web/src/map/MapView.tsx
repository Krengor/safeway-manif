import { EVENT_META, MAX_ZONES_PER_REQUEST, ZONE_RES } from '@safeway/shared';
import { POLYGON_TO_CELLS_FLAGS, cellToLatLng, polygonToCellsExperimental } from 'h3-js';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Map as MlMap, Marker, addProtocol, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre 6 charge son worker (module ES) depuis un fichier séparé : Vite l'empaquette
// avec ses dépendances et le sert depuis notre origine (compatible CSP worker-src 'self').
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { LocalPosition } from '../lib/useManifMode';
import { cellPolygons, streetSegments, type CellSummary } from './overlay';
import { BASEMAP_SOURCE, DEFAULT_CENTER, DEFAULT_ZOOM, buildStyle } from './style';

let initialized = false;
function initMapLibre() {
  if (initialized) return;
  setWorkerUrl(workerUrl);
  addProtocol('pmtiles', new Protocol().tile);
  initialized = true;
}

const STATUS_COLORS = {
  light: { red: '#b91c1c', orange: '#c2410c', green: '#15803d', grey: '#6b7280' },
  dark: { red: '#f87171', orange: '#fb923c', green: '#22c55e', grey: '#9ca3af' },
};

const LONG_PRESS_MS = 550;
const MIN_ZOOM_FOR_EVENTS = 12;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface MapViewHandle {
  recenter(position: LocalPosition): void;
}

interface Props {
  cells: CellSummary[];
  position: LocalPosition | null;
  dark: boolean;
  /** Zones H3 visibles, ou null si la vue est trop large pour charger les signalements. */
  onZonesChange(zones: string[] | null): void;
  onSelectCell(cell: string): void;
  onLongPress(lngLat: { lng: number; lat: number }): void;
}

function statusColor(dark: boolean): ExpressionSpecification {
  const c = STATUS_COLORS[dark ? 'dark' : 'light'];
  return ['match', ['get', 'status'], 'red', c.red, 'orange', c.orange, 'green', c.green, c.grey];
}

function visibleZones(map: MlMap): string[] | null {
  if (map.getZoom() < MIN_ZOOM_FOR_EVENTS) return null;
  const b = map.getBounds();
  const ring = [
    [b.getWest(), b.getSouth()],
    [b.getEast(), b.getSouth()],
    [b.getEast(), b.getNorth()],
    [b.getWest(), b.getNorth()],
    [b.getWest(), b.getSouth()],
  ];
  const zones = polygonToCellsExperimental([ring], ZONE_RES, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true);
  return zones.length > MAX_ZONES_PER_REQUEST ? null : zones.sort();
}

function positionData(position: LocalPosition | null): GeoJSON.FeatureCollection {
  if (!position) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [position.lng, position.lat] } }],
  };
}

/** Ajoute nos calques au-dessus du fond de carte (à chaque chargement de style). */
function addOverlayLayers(map: MlMap, dark: boolean) {
  map.addSource('sw-cells', { type: 'geojson', data: EMPTY });
  map.addSource('sw-streets', { type: 'geojson', data: EMPTY });
  map.addSource('sw-me', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'sw-cells-fill',
    type: 'fill',
    source: 'sw-cells',
    paint: { 'fill-color': statusColor(dark), 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: 'sw-cells-outline',
    type: 'line',
    source: 'sw-cells',
    paint: { 'line-color': statusColor(dark), 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
  });
  map.addLayer({
    id: 'sw-streets',
    type: 'line',
    source: 'sw-streets',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': statusColor(dark),
      'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 3, 16, 7, 19, 22],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'sw-me-halo',
    type: 'circle',
    source: 'sw-me',
    paint: { 'circle-radius': 14, 'circle-color': '#2563eb', 'circle-opacity': 0.2 },
  });
  map.addLayer({
    id: 'sw-me',
    type: 'circle',
    source: 'sw-me',
    paint: { 'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 },
  });
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const scheduleStreets = useRef<() => void>(() => {});
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    recenter(position) {
      const map = mapRef.current;
      map?.easeTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 16) });
    },
  }));

  // Initialisation unique de la carte.
  useEffect(() => {
    initMapLibre();
    const map = new MlMap({
      container: container.current!,
      style: buildStyle(latest.current.dark),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    const redrawStreets = () => {
      map.getSource<GeoJSONSource>('sw-streets')?.setData(streetSegments(map, latest.current.cells));
    };
    let streetTimer: number | undefined;
    scheduleStreets.current = () => {
      window.clearTimeout(streetTimer);
      streetTimer = window.setTimeout(redrawStreets, 150);
    };

    // 'style.load' : premier chargement ET changement de thème (setStyle efface nos calques).
    map.on('style.load', () => {
      const { dark, cells, position } = latest.current;
      addOverlayLayers(map, dark);
      map.getSource<GeoJSONSource>('sw-cells')?.setData(cellPolygons(cells));
      map.getSource<GeoJSONSource>('sw-me')?.setData(positionData(position));
      scheduleStreets.current();
    });
    map.on('load', () => latest.current.onZonesChange(visibleZones(map)));
    map.on('moveend', () => {
      latest.current.onZonesChange(visibleZones(map));
      scheduleStreets.current();
    });
    map.on('sourcedata', (e) => {
      if (e.sourceId === BASEMAP_SOURCE && e.isSourceLoaded) scheduleStreets.current();
    });

    // Appui long (mobile) / clic droit (desktop) : signaler à un endroit précis.
    let pressTimer: number | undefined;
    let pressStart: { x: number; y: number } | null = null;
    const cancelPress = () => {
      window.clearTimeout(pressTimer);
      pressStart = null;
    };
    map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return cancelPress();
      pressStart = { x: e.point.x, y: e.point.y };
      const { lng, lat } = e.lngLat;
      pressTimer = window.setTimeout(() => {
        navigator.vibrate?.(20);
        latest.current.onLongPress({ lng, lat });
      }, LONG_PRESS_MS);
    });
    map.on('touchmove', (e) => {
      if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 10) cancelPress();
    });
    map.on('touchend', cancelPress);
    map.on('movestart', cancelPress);
    map.on('contextmenu', (e) => latest.current.onLongPress({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

    const currentMarkers = markers.current;
    return () => {
      window.clearTimeout(streetTimer);
      cancelPress();
      for (const marker of currentMarkers.values()) marker.remove();
      currentMarkers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Thème clair/sombre.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    map.setStyle(buildStyle(props.dark), { diff: false });
  }, [props.dark]);

  // Hexagones, rues colorées et marqueurs accessibles (icône + texte, §25).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getSource<GeoJSONSource>('sw-cells')?.setData(cellPolygons(props.cells));
    scheduleStreets.current();

    const seen = new Set<string>();
    for (const summary of props.cells) {
      seen.add(summary.cell);
      let marker = markers.current.get(summary.cell);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'sw-marker';
        const cell = summary.cell;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          latest.current.onSelectCell(cell);
        });
        const [lat, lng] = cellToLatLng(cell);
        marker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        markers.current.set(cell, marker);
      }
      const el = marker.getElement();
      const meta = EVENT_META[summary.top.type];
      el.dataset.status = summary.status;
      el.setAttribute('aria-label', `${summary.events.map((e) => EVENT_META[e.type].label).join(', ')}. Ouvrir le détail.`);
      el.replaceChildren(...markerContent(meta.icon, meta.short, summary.events.length));
    }
    for (const [cell, marker] of markers.current) {
      if (!seen.has(cell)) {
        marker.remove();
        markers.current.delete(cell);
      }
    }
  }, [props.cells]);

  // Point « vous êtes ici » : affiché localement, jamais transmis.
  useEffect(() => {
    mapRef.current?.getSource<GeoJSONSource>('sw-me')?.setData(positionData(props.position));
  }, [props.position]);

  // Conteneur enveloppé : maplibre-gl.css impose `position: relative` au nœud de la carte.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="application" aria-label="Carte des signalements" />
    </div>
  );
});

function markerContent(icon: string, short: string, count: number): Node[] {
  const span = (cls: string | null, text: string) => {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  };
  const iconEl = span(null, icon);
  iconEl.setAttribute('aria-hidden', 'true');
  const nodes: Node[] = [iconEl, span('sw-marker-label', short)];
  if (count > 1) {
    const badge = span('sw-marker-count', '');
    badge.append(span(null, String(count)));
    nodes.push(badge);
  }
  return nodes;
}

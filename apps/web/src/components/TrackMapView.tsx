import maplibregl, { type Map as MaplibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { Track, TrackPoint } from "../api/tracks";
import { bearingDeg } from "../geo";
import { iconId, registerVesselIcons } from "../mapIcons";
import { styleUrlForTheme } from "../mapStyle";
import type { Theme } from "../ThemeContext";

const RUN_SOURCE_ID = "history-run";
const RUN_LAYER_ID = "history-run-line";
const GAP_SOURCE_ID = "history-gap";
const GAP_LAYER_ID = "history-gap-line";
const POINTS_SOURCE_ID = "history-points";
const POINTS_LAYER_ID = "history-points-circle";
const LATEST_SOURCE_ID = "history-latest";
const LATEST_LAYER_ID = "history-latest-icon";
const MAX_HOVER_POINTS_PER_VESSEL = 150;

export interface VesselTrackEntry {
  mmsi: string;
  name: string | null;
  color: string;
  track: Track | null;
}

export interface HoverPointInfo {
  mmsi: string;
  name: string | null;
  color: string;
  time: string;
  lon: number;
  lat: number;
  sogKn: number | null;
  source: string;
}

interface Props {
  entries: VesselTrackEntry[];
  theme: Theme;
  onHoverPoint: (info: HoverPointInfo | null) => void;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function vesselLabel(entry: VesselTrackEntry): string {
  return entry.name ?? entry.mmsi;
}

// One LineString per segment -- gaps (space between segments) are never
// bridged by this layer; see gapLinesFor for the separate, visually
// distinct indicator of what's between them. Every vessel's lines share
// one source/layer, colour-coded via a per-feature "color" property, so
// adding/removing a vessel from the selection never needs its own
// addLayer/removeLayer call.
function runLinesFor(entries: VesselTrackEntry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const entry of entries) {
    if (!entry.track) continue;
    for (const segment of entry.track.segments) {
      if (segment.points.length < 2) continue;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: segment.points.map((p) => [p.lon, p.lat]) },
        properties: { mmsi: entry.mmsi, color: entry.color },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// A dashed straight line between consecutive segments' endpoints --
// deliberately not a real path, just a visual "something is missing here"
// marker so a gap never reads as an ordinary quiet stretch of travel.
function gapLinesFor(entries: VesselTrackEntry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const entry of entries) {
    if (!entry.track) continue;
    const segments = entry.track.segments;
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i].points.at(-1);
      const b = segments[i + 1].points[0];
      if (!a || !b) continue;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
        properties: { mmsi: entry.mmsi, color: entry.color },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// Full-resolution points feed the line; only a decimated subset per
// vessel gets its own hoverable circle, to keep the layer light on a long
// track.
function hoverPointsFor(entries: VesselTrackEntry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const entry of entries) {
    if (!entry.track) continue;
    const all = entry.track.segments.flatMap((s) => s.points);
    const step = Math.max(1, Math.floor(all.length / MAX_HOVER_POINTS_PER_VESSEL));
    all.forEach((p, i) => {
      if (i % step !== 0 && i !== all.length - 1) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          mmsi: entry.mmsi,
          name: entry.name,
          color: entry.color,
          time: p.time,
          sogKn: p.sog_kn,
          source: p.source,
        },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

// Track points only carry speed, never heading/COG (position_observations
// doesn't store it) -- approximate orientation from the bearing between
// the last two points instead. Falls back to an unoriented circle (or a
// square if stopped) rather than guessing a heading from a single point.
function latestIconFor(points: TrackPoint[]): { shape: "arrow" | "square" | "circle"; heading: number } {
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  if (last.sog_kn != null && last.sog_kn < 0.5) {
    return { shape: "square", heading: 0 };
  }
  if (secondLast) {
    return { shape: "arrow", heading: bearingDeg(secondLast, last) };
  }
  return { shape: "circle", heading: 0 };
}

function latestIconsFor(entries: VesselTrackEntry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const entry of entries) {
    if (!entry.track) continue;
    const points = entry.track.segments.flatMap((s) => s.points);
    if (points.length === 0) continue;
    const last = points[points.length - 1];
    const { shape, heading } = latestIconFor(points);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [last.lon, last.lat] },
      properties: { mmsi: entry.mmsi, color: entry.color, icon: iconId(shape, "solid"), heading },
    });
  }
  return { type: "FeatureCollection", features };
}

function boundsFor(entries: VesselTrackEntry[]): [[number, number], [number, number]] | null {
  const all = entries.flatMap((e) => e.track?.segments.flatMap((s) => s.points) ?? []);
  if (all.length === 0) return null;
  const lons = all.map((p) => p.lon);
  const lats = all.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function TrackMapView({ entries, theme, onHoverPoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const lastFitRef = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  const onHoverPointRef = useRef(onHoverPoint);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    onHoverPointRef.current = onHoverPoint;
  }, [onHoverPoint]);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrlForTheme(theme),
        center: [19.4, 59.2],
        zoom: 5,
        minZoom: 3,
        maxZoom: 14,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed to initialize the map");
      return;
    }
    mapRef.current = map;
    // A freshly (re)created map instance has never fitted anything, so
    // the load handler's applyTracks call below must always fit bounds
    // once -- only later, data-driven calls should skip a redundant fit.
    lastFitRef.current = null;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("error", (event) => setMapError(event.error?.message ?? "Map error"));

    map.on("load", () => {
      registerVesselIcons(map);

      map.addSource(RUN_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: RUN_LAYER_ID,
        type: "line",
        source: RUN_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2.4, "line-opacity": 0.95 },
      });

      map.addSource(GAP_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: GAP_LAYER_ID,
        type: "line",
        source: GAP_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.6,
          "line-opacity": 0.9,
          "line-dasharray": [2, 2],
        },
      });

      map.addSource(POINTS_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: POINTS_LAYER_ID,
        type: "circle",
        source: POINTS_SOURCE_ID,
        paint: {
          "circle-radius": 3,
          "circle-color": "#0e171f",
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.2,
        },
      });

      map.addSource(LATEST_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: LATEST_LAYER_ID,
        type: "symbol",
        source: LATEST_SOURCE_ID,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": 0.85,
        },
        paint: { "icon-color": ["get", "color"] },
      });

      map.on("mousemove", POINTS_LAYER_ID, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const props = feature.properties as {
          mmsi: string;
          name: string | null;
          color: string;
          time: string;
          sogKn: number | null;
          source: string;
        };
        const [lon, lat] = feature.geometry.coordinates;
        onHoverPointRef.current({
          mmsi: props.mmsi,
          name: props.name,
          color: props.color,
          time: props.time,
          lon,
          lat,
          sogKn: props.sogKn ?? null,
          source: props.source,
        });
      });
      map.on("mouseleave", POINTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        onHoverPointRef.current(null);
      });

      // Recreating the map on a theme switch (see the effect's dep array
      // below) means data set before "load" fired is lost -- replay it
      // immediately from the ref so a theme toggle doesn't blank the tracks.
      applyTracks(map, entriesRef.current, markersRef, lastFitRef);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      applyTracks(map, entries, markersRef, lastFitRef);
    } else {
      map.once("load", () => applyTracks(map, entries, markersRef, lastFitRef));
    }
  }, [entries]);

  if (mapError) {
    return (
      <div className="map-error">
        <h2>Map failed to load</h2>
        <p>{mapError}</p>
      </div>
    );
  }

  return <div ref={containerRef} className="history-map" />;
}

// Identifies "the same set of vessel tracks", so a re-render triggered by
// something unrelated (e.g. hovering a point, which changes HistoryPage's
// hoverInfo state and cascades down through a fresh but equivalent
// `entries` array) doesn't re-fit the viewport and undo the user's zoom.
function fitSignatureFor(entries: VesselTrackEntry[]): string {
  return entries
    .map((e) => `${e.mmsi}:${e.track?.point_count ?? 0}:${e.track?.window_start ?? ""}`)
    .sort()
    .join(",");
}

function applyTracks(
  map: MaplibreMap,
  entries: VesselTrackEntry[],
  markersRef: React.MutableRefObject<Marker[]>,
  lastFitRef: React.MutableRefObject<string | null>
) {
  const runSource = map.getSource(RUN_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const gapSource = map.getSource(GAP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const pointsSource = map.getSource(POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const latestSource = map.getSource(LATEST_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!runSource || !gapSource || !pointsSource || !latestSource) return;

  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [];

  const withData = entries.filter((e) => e.track);
  if (withData.length === 0) {
    runSource.setData(emptyFC());
    gapSource.setData(emptyFC());
    pointsSource.setData(emptyFC());
    latestSource.setData(emptyFC());
    return;
  }

  runSource.setData(runLinesFor(entries));
  gapSource.setData(gapLinesFor(entries));
  pointsSource.setData(hoverPointsFor(entries));
  latestSource.setData(latestIconsFor(entries));

  const newMarkers: Marker[] = [];
  for (const entry of withData) {
    const allPoints = entry.track!.segments.flatMap((s) => s.points);
    if (allPoints.length === 0) continue;
    const first = allPoints[0];
    const last = allPoints[allPoints.length - 1];
    const label = vesselLabel(entry);

    const startEl = document.createElement("div");
    startEl.className = "vlabel";
    startEl.style.borderColor = entry.color;
    startEl.style.color = entry.color;
    startEl.textContent = `${label} start · ${new Date(first.time).toLocaleString()}`;
    newMarkers.push(
      new maplibregl.Marker({ element: startEl, anchor: "left" }).setLngLat([first.lon, first.lat]).addTo(map)
    );

    const endEl = document.createElement("div");
    endEl.className = "vlabel vlabel-live";
    endEl.style.borderColor = entry.color;
    endEl.style.color = entry.color;
    endEl.textContent = `${label} latest · ${new Date(last.time).toLocaleString()}`;
    newMarkers.push(
      new maplibregl.Marker({ element: endEl, anchor: "left" }).setLngLat([last.lon, last.lat]).addTo(map)
    );
  }
  markersRef.current = newMarkers;

  const signature = fitSignatureFor(entries);
  if (signature !== lastFitRef.current) {
    const bounds = boundsFor(entries);
    if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
    lastFitRef.current = signature;
  }
}

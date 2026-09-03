import maplibregl, { type Map as MaplibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { Track } from "../api/tracks";
import { styleUrlForTheme } from "../mapStyle";
import type { Theme } from "../ThemeContext";

const RUN_SOURCE_ID = "history-run";
const RUN_LAYER_ID = "history-run-line";
const GAP_SOURCE_ID = "history-gap";
const GAP_LAYER_ID = "history-gap-line";
const POINTS_SOURCE_ID = "history-points";
const POINTS_LAYER_ID = "history-points-circle";
const MAX_HOVER_POINTS = 150;

export interface HoverPointInfo {
  time: string;
  lon: number;
  lat: number;
  sogKn: number | null;
  source: string;
}

interface Props {
  track: Track | null;
  theme: Theme;
  onHoverPoint: (info: HoverPointInfo | null) => void;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// One LineString per segment -- gaps (space between segments) are never
// bridged by this layer; see gapLinesFor for the separate, visually
// distinct indicator of what's between them.
function runLinesFor(track: Track): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: track.segments
      .filter((s) => s.points.length > 1)
      .map((s) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: s.points.map((p) => [p.lon, p.lat]) },
        properties: {},
      })),
  };
}

// A dashed straight line between consecutive segments' endpoints --
// deliberately not a real path, just a visual "something is missing here"
// marker so a gap never reads as an ordinary quiet stretch of travel.
function gapLinesFor(track: Track): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < track.segments.length - 1; i++) {
    const a = track.segments[i].points.at(-1);
    const b = track.segments[i + 1].points[0];
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
      properties: {},
    });
  }
  return { type: "FeatureCollection", features };
}

// Full-resolution points feed the line; only a decimated subset gets its
// own hoverable circle, to keep the layer light on a long track.
function hoverPointsFor(track: Track): GeoJSON.FeatureCollection {
  const all = track.segments.flatMap((s) => s.points);
  const step = Math.max(1, Math.floor(all.length / MAX_HOVER_POINTS));
  const features: GeoJSON.Feature[] = [];
  all.forEach((p, i) => {
    if (i % step !== 0 && i !== all.length - 1) return;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { time: p.time, sogKn: p.sog_kn, source: p.source },
    });
  });
  return { type: "FeatureCollection", features };
}

function boundsFor(track: Track): [[number, number], [number, number]] | null {
  const all = track.segments.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const lons = all.map((p) => p.lon);
  const lats = all.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function TrackMapView({ track, theme, onHoverPoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const trackRef = useRef(track);
  const onHoverPointRef = useRef(onHoverPoint);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("error", (event) => setMapError(event.error?.message ?? "Map error"));

    map.on("load", () => {
      map.addSource(RUN_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: RUN_LAYER_ID,
        type: "line",
        source: RUN_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#5ed6f6", "line-width": 2.4, "line-opacity": 0.95 },
      });

      map.addSource(GAP_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: GAP_LAYER_ID,
        type: "line",
        source: GAP_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#eb817f",
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
          "circle-stroke-color": "#5ed6f6",
          "circle-stroke-width": 1.2,
        },
      });

      map.on("mousemove", POINTS_LAYER_ID, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const props = feature.properties as { time: string; sogKn: number | null; source: string };
        const [lon, lat] = feature.geometry.coordinates;
        onHoverPointRef.current({
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
      // immediately from the ref so a theme toggle doesn't blank the track.
      applyTrack(map, trackRef.current, markersRef);
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
      applyTrack(map, track, markersRef);
    } else {
      map.once("load", () => applyTrack(map, track, markersRef));
    }
  }, [track]);

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

function applyTrack(map: MaplibreMap, track: Track | null, markersRef: React.MutableRefObject<Marker[]>) {
  const runSource = map.getSource(RUN_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const gapSource = map.getSource(GAP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const pointsSource = map.getSource(POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!runSource || !gapSource || !pointsSource) return;

  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [];

  if (!track) {
    runSource.setData(emptyFC());
    gapSource.setData(emptyFC());
    pointsSource.setData(emptyFC());
    return;
  }

  runSource.setData(runLinesFor(track));
  gapSource.setData(gapLinesFor(track));
  pointsSource.setData(hoverPointsFor(track));

  const allPoints = track.segments.flatMap((s) => s.points);
  if (allPoints.length > 0) {
    const first = allPoints[0];
    const last = allPoints[allPoints.length - 1];

    const startEl = document.createElement("div");
    startEl.className = "vlabel";
    startEl.textContent = `start · ${new Date(first.time).toLocaleString()}`;
    const startMarker = new maplibregl.Marker({ element: startEl, anchor: "left" })
      .setLngLat([first.lon, first.lat])
      .addTo(map);

    const endEl = document.createElement("div");
    endEl.className = "vlabel vlabel-live";
    endEl.textContent = `latest · ${new Date(last.time).toLocaleString()}`;
    const endMarker = new maplibregl.Marker({ element: endEl, anchor: "left" })
      .setLngLat([last.lon, last.lat])
      .addTo(map);

    markersRef.current = [startMarker, endMarker];
  }

  const bounds = boundsFor(track);
  if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
}

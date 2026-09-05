import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { Geofence, GeofenceShape } from "../api/geofences";
import { circlePolygonRing, haversineMeters } from "../geo";
import { styleUrlForTheme } from "../mapStyle";
import type { Theme } from "../ThemeContext";

const EXISTING_SOURCE_ID = "geofence-existing";
const EXISTING_FILL_LAYER_ID = "geofence-existing-fill";
const EXISTING_OUTLINE_LAYER_ID = "geofence-existing-outline";
const DRAFT_SOURCE_ID = "geofence-draft";
const DRAFT_FILL_LAYER_ID = "geofence-draft-fill";
const DRAFT_OUTLINE_LAYER_ID = "geofence-draft-outline";
const CENTER_SOURCE_ID = "geofence-center";
const CENTER_LAYER_ID = "geofence-center-point";

interface Props {
  theme: Theme;
  existingGeofences: Geofence[];
  shape: GeofenceShape;
  // Circle draft (shape === "circle").
  centerLon: number | null;
  centerLat: number | null;
  radiusM: number | null;
  onChange: (centerLon: number, centerLat: number, radiusM: number | null) => void;
  // Polygon draft (shape === "polygon") -- each click appends a vertex.
  polygonPoints: [number, number][];
  onPolygonChange: (points: [number, number][]) => void;
}

interface Draft {
  centerLon: number | null;
  centerLat: number | null;
  radiusM: number | null;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function circleFeature(centerLon: number, centerLat: number, radiusM: number): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [circlePolygonRing(centerLon, centerLat, radiusM)] },
    properties: {},
  };
}

function pointsFeatureCollection(points: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p },
      properties: {},
    })),
  };
}

// Below 3 points there's no polygon yet -- draw the in-progress path as a
// line so the operator can see where the shape is heading; at 3+ points
// preview it closed, same as it'll actually be stored.
function polygonDraftFeature(points: [number, number][]): GeoJSON.Feature | null {
  if (points.length < 2) return null;
  if (points.length < 3) {
    return { type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} };
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
    properties: {},
  };
}

function geofenceFeature(g: Geofence): GeoJSON.Feature | null {
  if (g.shape === "polygon" && g.polygon) {
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [g.polygon] }, properties: {} };
  }
  if (g.shape === "circle" && g.center_lon != null && g.center_lat != null && g.radius_m != null) {
    return circleFeature(g.center_lon, g.center_lat, g.radius_m);
  }
  return null;
}

function applyDraft(map: MaplibreMap, draft: Draft) {
  const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const centerSource = map.getSource(CENTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source || !centerSource) return;

  if (draft.centerLon == null || draft.centerLat == null) {
    source.setData(emptyFC());
    centerSource.setData(emptyFC());
    return;
  }
  centerSource.setData(pointsFeatureCollection([[draft.centerLon, draft.centerLat]]));
  source.setData(
    draft.radiusM != null
      ? { type: "FeatureCollection", features: [circleFeature(draft.centerLon, draft.centerLat, draft.radiusM)] }
      : emptyFC()
  );
}

function applyPolygonDraft(map: MaplibreMap, points: [number, number][]) {
  const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const centerSource = map.getSource(CENTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source || !centerSource) return;
  centerSource.setData(pointsFeatureCollection(points));
  const feature = polygonDraftFeature(points);
  source.setData(feature ? { type: "FeatureCollection", features: [feature] } : emptyFC());
}

function applyExisting(map: MaplibreMap, geofences: Geofence[]) {
  const source = map.getSource(EXISTING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features = geofences.map(geofenceFeature).filter((f): f is GeoJSON.Feature => f != null);
  source.setData({ type: "FeatureCollection", features });
}

function hintFor(shape: GeofenceShape, draft: Draft, polygonPoints: [number, number][]): string {
  if (shape === "polygon") {
    if (polygonPoints.length === 0) return "Click the map to place the first vertex.";
    if (polygonPoints.length < 3) return "Click to add another vertex (need at least 3).";
    return `${polygonPoints.length} vertices — keep clicking to add more, or fill in the name and save.`;
  }
  if (draft.centerLon == null) return "Click the map to place the geofence's center.";
  if (draft.radiusM == null) return "Move the mouse and click again to set the radius.";
  return "Click elsewhere to redraw, or fine-tune the fields below.";
}

export function GeofenceMapView({
  theme,
  existingGeofences,
  shape,
  centerLon,
  centerLat,
  radiusM,
  onChange,
  polygonPoints,
  onPolygonChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const shapeRef = useRef(shape);
  const onChangeRef = useRef(onChange);
  const onPolygonChangeRef = useRef(onPolygonChange);
  const draftRef = useRef<Draft>({ centerLon, centerLat, radiusM });
  const polygonPointsRef = useRef(polygonPoints);
  const existingRef = useRef(existingGeofences);
  const [mapError, setMapError] = useState<string | null>(null);
  const [hint, setHint] = useState(() => hintFor(shape, draftRef.current, polygonPoints));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChange;
  }, [onPolygonChange]);

  useEffect(() => {
    shapeRef.current = shape;
    setHint(hintFor(shape, draftRef.current, polygonPointsRef.current));
    if (mapRef.current) {
      if (shape === "polygon") applyPolygonDraft(mapRef.current, polygonPointsRef.current);
      else applyDraft(mapRef.current, draftRef.current);
    }
  }, [shape]);

  useEffect(() => {
    const draft = { centerLon, centerLat, radiusM };
    draftRef.current = draft;
    if (shapeRef.current === "circle") {
      setHint(hintFor("circle", draft, polygonPointsRef.current));
      if (mapRef.current) applyDraft(mapRef.current, draft);
    }
  }, [centerLon, centerLat, radiusM]);

  useEffect(() => {
    polygonPointsRef.current = polygonPoints;
    if (shapeRef.current === "polygon") {
      setHint(hintFor("polygon", draftRef.current, polygonPoints));
      if (mapRef.current) applyPolygonDraft(mapRef.current, polygonPoints);
    }
  }, [polygonPoints]);

  useEffect(() => {
    existingRef.current = existingGeofences;
    if (mapRef.current) applyExisting(mapRef.current, existingGeofences);
  }, [existingGeofences]);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrlForTheme(theme),
        center: draftRef.current.centerLon != null && draftRef.current.centerLat != null
          ? [draftRef.current.centerLon, draftRef.current.centerLat]
          : [19.75, 59.7],
        zoom: 4.7,
        minZoom: 2,
        maxZoom: 14,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed to initialize the map");
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("error", (event) => setMapError(event.error?.message ?? "Map error"));

    // MapLibre sizes its canvas from the container's dimensions at
    // construction time. In a flex/grid sidebar, the container isn't
    // always at its final width on that first measurement (e.g. this
    // panel's own layout is still settling), which leaves the canvas
    // permanently narrower than its container -- clicks past that edge
    // never reach the map at all. A ResizeObserver catches every layout
    // change (not just the initial one) and keeps the canvas in sync.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.addSource(EXISTING_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: EXISTING_FILL_LAYER_ID,
        type: "fill",
        source: EXISTING_SOURCE_ID,
        paint: { "fill-color": "#838e97", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: EXISTING_OUTLINE_LAYER_ID,
        type: "line",
        source: EXISTING_SOURCE_ID,
        paint: { "line-color": "#838e97", "line-width": 1.2, "line-dasharray": [2, 2] },
      });

      map.addSource(DRAFT_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: DRAFT_FILL_LAYER_ID,
        type: "fill",
        source: DRAFT_SOURCE_ID,
        paint: { "fill-color": "#5ed6f6", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: DRAFT_OUTLINE_LAYER_ID,
        type: "line",
        source: DRAFT_SOURCE_ID,
        paint: { "line-color": "#5ed6f6", "line-width": 2 },
      });

      map.addSource(CENTER_SOURCE_ID, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: CENTER_LAYER_ID,
        type: "circle",
        source: CENTER_SOURCE_ID,
        paint: {
          "circle-radius": 4,
          "circle-color": "#5ed6f6",
          "circle-stroke-color": "#0e171f",
          "circle-stroke-width": 1,
        },
      });

      // Recreating the map on a theme switch loses data set before "load"
      // fired -- replay both from refs so a theme toggle mid-draw doesn't
      // blank the draft or the existing-geofence overlay.
      applyExisting(map, existingRef.current);
      if (shapeRef.current === "polygon") applyPolygonDraft(map, polygonPointsRef.current);
      else applyDraft(map, draftRef.current);

      map.on("click", (e) => {
        if (shapeRef.current === "polygon") {
          onPolygonChangeRef.current([...polygonPointsRef.current, [e.lngLat.lng, e.lngLat.lat]]);
          return;
        }
        const draft = draftRef.current;
        if (draft.centerLon == null || draft.centerLat == null || draft.radiusM != null) {
          // No center yet, or both already set -- (re)start placement here.
          onChangeRef.current(e.lngLat.lng, e.lngLat.lat, null);
        } else {
          const radius = haversineMeters(
            { lat: draft.centerLat, lon: draft.centerLon },
            { lat: e.lngLat.lat, lon: e.lngLat.lng }
          );
          onChangeRef.current(draft.centerLon, draft.centerLat, Math.max(50, Math.round(radius)));
        }
      });

      map.on("mousemove", (e) => {
        if (shapeRef.current === "polygon") return;
        const draft = draftRef.current;
        if (draft.centerLon == null || draft.centerLat == null || draft.radiusM != null) return;
        const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        const previewRadius = haversineMeters(
          { lat: draft.centerLat, lon: draft.centerLon },
          { lat: e.lngLat.lat, lon: e.lngLat.lng }
        );
        source.setData({
          type: "FeatureCollection",
          features: [circleFeature(draft.centerLon, draft.centerLat, previewRadius)],
        });
      });
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  if (mapError) {
    return (
      <div className="geofence-draw-map" style={{ display: "grid", placeItems: "center", padding: 10 }}>
        <span style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>{mapError}</span>
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="geofence-draw-map" />
      <div className="geofence-draw-hint">{hint}</div>
    </div>
  );
}

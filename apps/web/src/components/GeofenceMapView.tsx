import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { Geofence } from "../api/geofences";
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
  centerLon: number | null;
  centerLat: number | null;
  radiusM: number | null;
  onChange: (centerLon: number, centerLat: number, radiusM: number | null) => void;
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

function applyDraft(map: MaplibreMap, draft: Draft) {
  const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const centerSource = map.getSource(CENTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source || !centerSource) return;

  if (draft.centerLon == null || draft.centerLat == null) {
    source.setData(emptyFC());
    centerSource.setData(emptyFC());
    return;
  }
  centerSource.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [draft.centerLon, draft.centerLat] },
        properties: {},
      },
    ],
  });
  source.setData(
    draft.radiusM != null
      ? { type: "FeatureCollection", features: [circleFeature(draft.centerLon, draft.centerLat, draft.radiusM)] }
      : emptyFC()
  );
}

function applyExisting(map: MaplibreMap, geofences: Geofence[]) {
  const source = map.getSource(EXISTING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: "FeatureCollection",
    features: geofences.map((g) => circleFeature(g.center_lon, g.center_lat, g.radius_m)),
  });
}

function hintFor(draft: Draft): string {
  if (draft.centerLon == null) return "Click the map to place the geofence's center.";
  if (draft.radiusM == null) return "Move the mouse and click again to set the radius.";
  return "Click elsewhere to redraw, or fine-tune the fields below.";
}

export function GeofenceMapView({
  theme,
  existingGeofences,
  centerLon,
  centerLat,
  radiusM,
  onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const onChangeRef = useRef(onChange);
  const draftRef = useRef<Draft>({ centerLon, centerLat, radiusM });
  const existingRef = useRef(existingGeofences);
  const [mapError, setMapError] = useState<string | null>(null);
  const [hint, setHint] = useState(() => hintFor(draftRef.current));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const draft = { centerLon, centerLat, radiusM };
    draftRef.current = draft;
    setHint(hintFor(draft));
    if (mapRef.current) applyDraft(mapRef.current, draft);
  }, [centerLon, centerLat, radiusM]);

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
      applyDraft(map, draftRef.current);

      map.on("click", (e) => {
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

import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { LiveVessel } from "../api/live";
import { styleUrlForTheme } from "../mapStyle";
import type { Theme } from "../ThemeContext";
import { freshnessForTime, type Freshness } from "../freshness";
import {
  iconId,
  registerVesselIcons,
  createSelectionRingIcon,
  type MarkerFillStyle,
  type MarkerShape,
} from "../mapIcons";

const SOURCE_ID = "vessels";
const LAYER_ID = "vessel-markers";
const SELECTION_SOURCE_ID = "vessel-selection";
const SELECTION_LAYER_ID = "vessel-selection-ring";
const LABEL_LAYER_ID = "vessel-labels";
const HALO_LAYER_ID = "vessel-halo";
const CLUSTER_LAYER_ID = "vessel-clusters";
const CLUSTER_COUNT_LAYER_ID = "vessel-cluster-count";
const NAMED_LABEL_MIN_ZOOM = 7;
// Design handoff: "clustering below zoom 7" -- native MapLibre GeoJSON
// clustering handles the aggregation; individual markers take over again
// at/above this zoom, same threshold as the name-label reveal.
const CLUSTER_MAX_ZOOM = 7;
// Only individual vessel features carry our own properties (icon,
// shape, freshness, ...); a cluster's synthetic representative point
// doesn't, so every vessel-specific layer must exclude it explicitly.
const NOT_CLUSTER_FILTER: maplibregl.FilterSpecification = ["!", ["has", "point_count"]];

function haloColorForTheme(theme: Theme): string {
  // A halo whose lightness is the *opposite* of the basemap's makes a
  // colored marker read as a distinct object rather than blending into
  // whatever's under it -- a light glow against the dark basemap, a dark
  // ring against the pale "positron" one.
  return theme === "light" ? "rgba(10, 14, 18, 0.55)" : "rgba(255, 255, 255, 0.6)";
}

type Bounds = [[number, number], [number, number]];

function fillStyleFor(freshness: Freshness): MarkerFillStyle {
  if (freshness === "live" || freshness === "delayed") return "solid";
  if (freshness === "stale") return "hollow";
  return "dashed";
}

function shapeFor(vessel: LiveVessel): MarkerShape {
  if (vessel.sogKn != null && vessel.sogKn < 0.5) return "square";
  if (vessel.headingDeg != null || vessel.cogDeg != null) return "arrow";
  return "circle";
}

function vesselsToGeoJson(
  vessels: Map<string, LiveVessel>,
  selectedMmsi: string | null,
  highlightMmsis: Set<string> | null
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Array.from(vessels.values()).map((vessel) => {
      const freshness = freshnessForTime(vessel.observedAt ?? vessel.receivedAt);
      const shape = shapeFor(vessel);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [vessel.lon, vessel.lat] },
        properties: {
          mmsi: vessel.mmsi,
          name: vessel.name ?? vessel.mmsi,
          shape,
          heading: vessel.headingDeg ?? vessel.cogDeg ?? 0,
          icon: iconId(shape, fillStyleFor(freshness)),
          freshness,
          isSelected: vessel.mmsi === selectedMmsi,
          isDimmed: highlightMmsis != null && !highlightMmsis.has(vessel.mmsi),
        },
      };
    }),
  };
}

export interface MapMoveEnd {
  bbox: { min_lon: number; min_lat: number; max_lon: number; max_lat: number };
  center: [number, number];
  zoom: number;
}

interface Props {
  vessels: Map<string, LiveVessel>;
  onMoveEnd: (view: MapMoveEnd) => void;
  selectedMmsi: string | null;
  onSelectVessel: (mmsi: string | null) => void;
  focusBounds: Bounds | null;
  theme: Theme;
  // Restores the camera across a route change (Map -> History -> Map),
  // which fully unmounts this component -- see mapViewMemory.ts.
  initialCenter?: [number, number];
  initialZoom?: number;
  // When set, vessels NOT in this set render dimmed -- lets "show all
  // vessels" still make a watchlist's members visually stand out.
  highlightMmsis: Set<string> | null;
}

export function MapView({
  vessels,
  onMoveEnd,
  selectedMmsi,
  onSelectVessel,
  focusBounds,
  theme,
  initialCenter,
  initialZoom,
  highlightMmsis,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const onSelectVesselRef = useRef(onSelectVessel);
  // Remembers the viewport across a theme switch, since that tears down
  // and recreates the whole Map instance (simplest way to swap basemap
  // style without hand-reattaching every layer/source/handler).
  const viewStateRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    onSelectVesselRef.current = onSelectVessel;
  }, [onSelectVessel]);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialView = viewStateRef.current;
    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrlForTheme(theme),
        // Default viewport: centred on the whole Baltic Sea (see
        // worker/config.py's DEFAULT_BOUNDING_BOXES), unless a prior
        // theme switch or a just-restored session (see mapViewMemory.ts)
        // has a viewport to restore instead.
        center: initialView?.center ?? initialCenter ?? [19.75, 59.7],
        zoom: initialView?.zoom ?? initialZoom ?? 4.7,
        minZoom: 4,
        // High enough for harbor/berth-level detail; the basemap simply
        // overzooms past its own native tile resolution beyond ~16-18,
        // same as any other web map.
        maxZoom: 19,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed to initialize the map");
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("error", (event) => {
      setMapError(event.error?.message ?? "Map error");
    });

    map.on("load", () => {
      registerVesselIcons(map);
      map.addImage("vessel-selection-ring", createSelectionRingIcon(26), { sdf: true });

      map.addSource(SELECTION_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SELECTION_LAYER_ID,
        type: "symbol",
        source: SELECTION_SOURCE_ID,
        layout: {
          "icon-image": "vessel-selection-ring",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": "#5ed6f6" },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 50,
      });

      // Cluster bubbles (design handoff: "aggregate to a grid, bubble
      // diameter 28/36/44px by count (>40, >120)"). Known simplification:
      // the handoff also says watchlisted vessels should always escape
      // their cluster and stay individually drawn -- not implemented,
      // since that needs a second, unclustered source just for them.
      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 14, 40, 18, 120, 22],
          "circle-color": "rgba(6, 52, 62, 0.82)",
          "circle-stroke-color": "#3a93aa",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: { "text-color": "#edf0f3" },
      });

      // A halo behind each icon so it reads as a distinct marker rather
      // than blending into the basemap underneath it -- same shape and
      // rotation as the real icon, just bigger and tinted with a fixed,
      // theme-contrasting color instead of the data-driven freshness one.
      map.addLayer({
        id: HALO_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: NOT_CLUSTER_FILTER,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["case", ["==", ["get", "shape"], "arrow"], ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": ["*", ["case", ["get", "isSelected"], 0.85, 0.6], 1.45],
        },
        paint: {
          "icon-color": haloColorForTheme(theme),
          "icon-opacity": ["case", ["get", "isDimmed"], 0.2, 0.85],
        },
      });

      // Shape carries movement state (arrow=under way+oriented,
      // square=stopped/anchored, circle=under way+unoriented); colour
      // carries freshness only (design handoff: "colour is never the only
      // encoding" -- shape is the redundant channel here, not a text label).
      map.addLayer({
        id: LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: NOT_CLUSTER_FILTER,
        layout: {
          "icon-image": ["get", "icon"],
          // Only the arrow shape encodes a heading -- squares (stopped/
          // anchored) and circles (orientation unknown) must always render
          // upright, never rotated to a COG/heading that isn't meaningful
          // for them.
          "icon-rotate": ["case", ["==", ["get", "shape"], "arrow"], ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": ["case", ["get", "isSelected"], 0.85, 0.6],
        },
        paint: {
          "icon-color": [
            "match",
            ["get", "freshness"],
            "live",
            "#58d8ae",
            "delayed",
            "#ebb353",
            "stale",
            "#eb817f",
            "#838e97",
          ],
          "icon-opacity": ["case", ["get", "isDimmed"], 0.35, 1],
        },
      });

      // Named vessels get a label at zoom >= 7, and the selection always
      // does, regardless of zoom (design handoff .vlabel spec).
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: NOT_CLUSTER_FILTER,
        minzoom: 0,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-offset": [0.9, -0.6],
          "text-anchor": "left",
          "text-optional": true,
        },
        paint: {
          "text-color": "#edf0f3",
          "text-halo-color": "rgba(14, 23, 31, 0.9)",
          "text-halo-width": 1.2,
          // A "zoom" expression may only be the top-level input of a
          // step/interpolate, never nested inside a case/match -- so zoom
          // has to be the outer expression here, with the isSelected
          // case as its below-threshold branch, not the other way round.
          "text-opacity": [
            "step",
            ["zoom"],
            ["case", ["get", "isSelected"], 1, 0],
            NAMED_LABEL_MIN_ZOOM,
            1,
          ],
        },
      });

      map.on("click", LAYER_ID, (e) => {
        const feature = e.features?.[0];
        const mmsi = feature?.properties?.mmsi as string | undefined;
        if (mmsi) onSelectVesselRef.current(mmsi);
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
        if (hits.length === 0) onSelectVesselRef.current(null);
      });

      map.on("mouseenter", LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      // Design handoff: "Cluster click -> zoom +2 to centroid."
      map.on("click", CLUSTER_LAYER_ID, (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: map.getZoom() + 2 });
      });
      map.on("mouseenter", CLUSTER_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", CLUSTER_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      const emitMoveEnd = () => {
        const bounds = map.getBounds();
        const center = map.getCenter();
        onMoveEnd({
          bbox: {
            min_lon: bounds.getWest(),
            min_lat: bounds.getSouth(),
            max_lon: bounds.getEast(),
            max_lat: bounds.getNorth(),
          },
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
        });
      };
      map.on("moveend", emitMoveEnd);
      emitMoveEnd();
    });

    return () => {
      const center = map.getCenter();
      viewStateRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(vesselsToGeoJson(vessels, selectedMmsi, highlightMmsis));

    const selectionSource = map?.getSource(SELECTION_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    const selectedVessel = selectedMmsi ? vessels.get(selectedMmsi) : undefined;
    selectionSource?.setData({
      type: "FeatureCollection",
      features: selectedVessel
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [selectedVessel.lon, selectedVessel.lat] },
              properties: {},
            },
          ]
        : [],
    });
  }, [vessels, selectedMmsi, highlightMmsis]);

  useEffect(() => {
    if (focusBounds) {
      mapRef.current?.fitBounds(focusBounds, { padding: 60, maxZoom: 12 });
    }
  }, [focusBounds]);

  if (mapError) {
    return (
      <div className="map-error">
        <h2>Map failed to load</h2>
        <p>{mapError}</p>
        <p>
          This is usually a browser/GPU issue, not a server problem — MapLibre needs WebGL.
          Try a different browser, enable hardware acceleration, or check{" "}
          <code>chrome://gpu</code> (or your browser&apos;s equivalent) for WebGL status.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="map-canvas" />;
}

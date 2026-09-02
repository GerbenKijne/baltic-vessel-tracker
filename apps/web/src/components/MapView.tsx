import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { LiveVessel } from "../api/live";
import type { Track } from "../api/tracks";
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
const TRACK_SOURCE_ID = "vessel-track";
const TRACK_LAYER_ID = "vessel-track-line";
const NAMED_LABEL_MIN_ZOOM = 7;

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
  selectedMmsi: string | null
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
          heading: vessel.headingDeg ?? vessel.cogDeg ?? 0,
          icon: iconId(shape, fillStyleFor(freshness)),
          freshness,
          isSelected: vessel.mmsi === selectedMmsi,
        },
      };
    }),
  };
}

function trackToGeoJson(track: Track | null): GeoJSON.FeatureCollection {
  if (!track) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: track.segments
      .filter((segment) => segment.points.length > 1)
      .map((segment) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: segment.points.map((p) => [p.lon, p.lat]),
        },
        properties: {},
      })),
  };
}

interface Props {
  vessels: Map<string, LiveVessel>;
  onMoveEnd: (bbox: { min_lon: number; min_lat: number; max_lon: number; max_lat: number }) => void;
  selectedMmsi: string | null;
  onSelectVessel: (mmsi: string | null) => void;
  track: Track | null;
  focusBounds: Bounds | null;
}

export function MapView({
  vessels,
  onMoveEnd,
  selectedMmsi,
  onSelectVessel,
  track,
  focusBounds,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const onSelectVesselRef = useRef(onSelectVessel);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    onSelectVesselRef.current = onSelectVessel;
  }, [onSelectVessel]);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        // Dark/greyscale basemap: matches the app's dark chrome and makes
        // the freshness-coloured vessel markers stand out. Same glyphs/font
        // as "liberty" (confirmed against the style JSON) so this doesn't
        // reopen the font-404 issue from Phase 1.
        style: "https://tiles.openfreemap.org/styles/dark",
        // Default viewport: Sweden + Baltic, centre ~59.2N 19.4E (design
        // handoff). Zoom clamp 4-12 per the design's map behaviour spec.
        center: [19.4, 59.2],
        zoom: 6,
        minZoom: 4,
        maxZoom: 12,
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

      map.addSource(TRACK_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // One LineString feature per track segment -- gaps (PRD FR-008
      // "preserve gaps") are the space between segments, never a
      // connecting line.
      map.addLayer({
        id: TRACK_LAYER_ID,
        type: "line",
        source: TRACK_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "oklch(0.82 0.115 218)", "line-width": 2, "line-opacity": 0.85 },
      });

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
        paint: { "icon-color": "oklch(0.82 0.115 218)" },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Shape carries movement state (arrow=under way+oriented,
      // square=stopped/anchored, circle=under way+unoriented); colour
      // carries freshness only (design handoff: "colour is never the only
      // encoding" -- shape is the redundant channel here, not a text label).
      map.addLayer({
        id: LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": ["case", ["get", "isSelected"], 0.85, 0.6],
        },
        paint: {
          "icon-color": [
            "match",
            ["get", "freshness"],
            "live",
            "oklch(0.8 0.13 168)",
            "delayed",
            "oklch(0.8 0.13 78)",
            "stale",
            "oklch(0.72 0.13 22)",
            "oklch(0.64 0.018 245)",
          ],
        },
      });

      // Named vessels get a label at zoom >= 7, and the selection always
      // does, regardless of zoom (design handoff .vlabel spec).
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
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
          "text-color": "oklch(0.955 0.005 245)",
          "text-halo-color": "oklch(0.2 0.02 245 / .9)",
          "text-halo-width": 1.2,
          "text-opacity": [
            "case",
            ["get", "isSelected"],
            1,
            ["step", ["zoom"], 0, NAMED_LABEL_MIN_ZOOM, 1],
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

      const emitBbox = () => {
        const bounds = map.getBounds();
        onMoveEnd({
          min_lon: bounds.getWest(),
          min_lat: bounds.getSouth(),
          max_lon: bounds.getEast(),
          max_lat: bounds.getNorth(),
        });
      };
      map.on("moveend", emitBbox);
      emitBbox();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(vesselsToGeoJson(vessels, selectedMmsi));

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
  }, [vessels, selectedMmsi]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(TRACK_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(trackToGeoJson(track));
  }, [track]);

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

import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { LiveVessel } from "../api/live";

const LIVE_FRESH_SECONDS = 120;
const STALE_SECONDS = 900;

type Freshness = "live" | "delayed" | "stale";

function freshnessOf(vessel: LiveVessel): Freshness {
  const reference = vessel.observedAt ?? vessel.receivedAt;
  const ageSeconds = (Date.now() - new Date(reference).getTime()) / 1000;
  if (ageSeconds <= LIVE_FRESH_SECONDS) return "live";
  if (ageSeconds <= STALE_SECONDS) return "delayed";
  return "stale";
}

function vesselsToGeoJson(vessels: Map<string, LiveVessel>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Array.from(vessels.values()).map((vessel) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [vessel.lon, vessel.lat] },
      properties: {
        mmsi: vessel.mmsi,
        name: vessel.name ?? "Unknown",
        heading: vessel.headingDeg ?? vessel.cogDeg ?? 0,
        hasOrientation: vessel.headingDeg !== null || vessel.cogDeg !== null,
        freshness: freshnessOf(vessel),
      },
    })),
  };
}

const SOURCE_ID = "vessels";
const LAYER_ID = "vessel-markers";

interface Props {
  vessels: Map<string, LiveVessel>;
  onMoveEnd: (bbox: { min_lon: number; min_lat: number; max_lon: number; max_lat: number }) => void;
}

export function MapView({ vessels, onMoveEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        // Default viewport: Sweden and the Baltic (PRD SS7.2).
        center: [18.0, 58.5],
        zoom: 5,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed to initialize the map");
      return;
    }
    mapRef.current = map;
    // Temporary debugging aid to inspect the live map/source from the
    // browser console — remove once the vessel-rendering issue is found.
    (window as unknown as { __map: MaplibreMap }).__map = map;

    map.on("error", (event) => {
      setMapError(event.error?.message ?? "Map error");
    });

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "match",
            ["get", "freshness"],
            "live",
            "#1a9850",
            "delayed",
            "#fdae61",
            "stale",
            "#999999",
            "#999999",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#1b2733",
        },
      });

      // Freshness is never color-only (PRD SS7.3): pair the marker color
      // with a short text label.
      map.addLayer({
        id: `${LAYER_ID}-label`,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": [
            "match",
            ["get", "freshness"],
            "live",
            "L",
            "delayed",
            "D",
            "stale",
            "S",
            "?",
          ],
          "text-size": 10,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1b2733",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
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
    source?.setData(vesselsToGeoJson(vessels));
  }, [vessels]);

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

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

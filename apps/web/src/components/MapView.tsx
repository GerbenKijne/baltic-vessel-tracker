import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { LiveVessel } from "../api/live";

const LIVE_FRESH_SECONDS = 120;
const STALE_SECONDS = 900;
const ICON_SIZE = 24;

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
        heading: vessel.headingDeg ?? vessel.cogDeg ?? 0,
        hasOrientation: vessel.headingDeg !== null || vessel.cogDeg !== null,
        freshness: freshnessOf(vessel),
      },
    })),
  };
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatNavStatus(navStatus: string | null): string {
  if (!navStatus) return "Unknown";
  const spaced = navStatus.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Draws a plain filled shape (not a mathematically correct signed-distance
 * field, just a hard-edged alpha mask) -- MapLibre's SDF renderer accepts
 * this as a reasonable approximation at the small icon sizes used here,
 * and it's what lets a single icon be recolored per-feature via
 * icon-color instead of pre-baking one image per freshness color. */
function createArrowIcon(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.lineTo(size * 0.85, size * 0.92);
  ctx.lineTo(size * 0.5, size * 0.72);
  ctx.lineTo(size * 0.15, size * 0.92);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function createDotIcon(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function renderVesselPopupHtml(vessel: LiveVessel): string {
  const freshness = freshnessOf(vessel);
  const name = vessel.name ? escapeHtml(vessel.name) : "Unknown";
  const time = vessel.observedAt
    ? `${new Date(vessel.observedAt).toLocaleString()} (observed)`
    : `${new Date(vessel.receivedAt).toLocaleString()} (received)`;
  const rows: [string, string][] = [
    ["Position", `${vessel.lat.toFixed(4)}, ${vessel.lon.toFixed(4)}`],
    ["Speed", vessel.sogKn != null ? `${vessel.sogKn.toFixed(1)} kn` : "Unknown"],
    ["Course", vessel.cogDeg != null ? `${vessel.cogDeg.toFixed(0)}°` : "Unknown"],
    ["Heading", vessel.headingDeg != null ? `${vessel.headingDeg}°` : "Unknown"],
    ["Status", formatNavStatus(vessel.navStatus)],
    ["Freshness", freshness],
    ["Last position", time],
  ];
  if (vessel.qualityFlags.length > 0) {
    rows.push(["Flags", vessel.qualityFlags.map(escapeHtml).join(", ")]);
  }

  const rowsHtml = rows
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${value}</td></tr>`)
    .join("");

  return (
    `<div class="vessel-popup">` +
    `<h3>${name}</h3>` +
    `<div class="vessel-popup-mmsi">MMSI ${escapeHtml(vessel.mmsi)}</div>` +
    `<table>${rowsHtml}</table>` +
    `</div>`
  );
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
  const vesselsRef = useRef(vessels);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const selectedMmsiRef = useRef<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        // Dark/greyscale basemap: matches the app's dark chrome and makes
        // the colored vessel markers stand out more than a full-color
        // basemap would. Same glyphs/font as "liberty" (confirmed against
        // the style JSON) so this doesn't reopen the font-404 issue.
        style: "https://tiles.openfreemap.org/styles/dark",
        // Default viewport: Sweden and the Baltic (PRD SS7.2).
        center: [18.0, 58.5],
        zoom: 5,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed to initialize the map");
      return;
    }
    mapRef.current = map;

    map.on("error", (event) => {
      setMapError(event.error?.message ?? "Map error");
    });

    map.on("load", () => {
      map.addImage("vessel-arrow", createArrowIcon(ICON_SIZE), { sdf: true });
      map.addImage("vessel-dot", createDotIcon(ICON_SIZE), { sdf: true });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Markers rotate by heading (falling back to COG) with a distinct
      // glyph -- a dot, not an arrow -- when neither is known (PRD SS7.2).
      map.addLayer({
        id: LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": ["case", ["get", "hasOrientation"], "vessel-arrow", "vessel-dot"],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": 0.75,
        },
        paint: {
          "icon-color": [
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
        },
      });

      // Freshness is never color-only (PRD SS7.3): pair the marker color
      // with a short text label.
      //
      // text-font must be a font this style's glyphs server actually
      // serves. Leaving it unset falls back to MapLibre's spec default
      // ("Open Sans Regular, Arial Unicode MS Regular"), which OpenFreeMap
      // doesn't host — the resulting 404 doesn't just fail the label, it
      // fails the *tile* for every layer sharing this source, including
      // the unrelated circle layer above (no vessels rendered at all,
      // with no visible error unless you inspect the network tab). Found
      // via a live NAS deploy; "Noto Sans Regular" is what OpenFreeMap's
      // "liberty" style actually ships.
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
          "text-font": ["Noto Sans Regular"],
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

      map.on("click", LAYER_ID, (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const mmsi = feature.properties?.mmsi as string | undefined;
        if (!mmsi) return;
        const vessel = vesselsRef.current.get(mmsi);
        if (!vessel) return;

        const lngLat: [number, number] = [vessel.lon, vessel.lat];
        const html = renderVesselPopupHtml(vessel);

        popupRef.current?.remove();
        const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "280px" })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);
        popup.on("close", () => {
          if (selectedMmsiRef.current === mmsi) {
            selectedMmsiRef.current = null;
            popupRef.current = null;
          }
        });
        popupRef.current = popup;
        selectedMmsiRef.current = mmsi;
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
    vesselsRef.current = vessels;

    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(vesselsToGeoJson(vessels));

    // A selected vessel's popup stays open and up to date as new
    // positions arrive, tracking it on the map (PRD SS7.2: "Selecting a
    // vessel pins it through incremental updates").
    const selectedMmsi = selectedMmsiRef.current;
    if (selectedMmsi && popupRef.current) {
      const vessel = vessels.get(selectedMmsi);
      if (vessel) {
        popupRef.current.setLngLat([vessel.lon, vessel.lat]);
        popupRef.current.setHTML(renderVesselPopupHtml(vessel));
      }
    }
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

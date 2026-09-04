import type { Freshness } from "./freshness";

export interface Bbox {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface MapViewMemory {
  center: [number, number];
  zoom: number;
  bbox: Bbox;
  selectedWatchlistId: string | null;
  watchlistOnly: boolean;
  freshnessFilter: Freshness[];
  typeFilter: string[];
}

// Module-level, not React state: MapPage/MapView fully unmount when
// navigating to another route (e.g. History), so a plain useState/useRef
// would reset on the way back. This survives that -- but not a full page
// reload, which is fine, since only in-app navigation needs to feel
// like "the map was exactly how I left it".
let memory: MapViewMemory | null = null;

export function saveMapViewMemory(state: MapViewMemory): void {
  memory = state;
}

export function getMapViewMemory(): MapViewMemory | null {
  return memory;
}

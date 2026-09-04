import { request } from "./client";

export interface TrackPoint {
  lon: number;
  lat: number;
  time: string;
  time_source: string;
  sog_kn: number | null;
  quality_flags: string[];
  source: string;
}

export interface TrackSegment {
  points: TrackPoint[];
}

export interface Track {
  mmsi: string;
  window_start: string;
  window_end: string;
  segments: TrackSegment[];
  point_count: number;
  truncated: boolean;
}

export const tracksApi = {
  getRange: (mmsi: string, from: Date, to: Date) => {
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return request<Track>(`/api/v1/vessels/${mmsi}/track?${params.toString()}`);
  },
};

import { request } from "./client";

export interface VesselSearchResult {
  mmsi: string;
  name: string | null;
  imo: number | null;
  last_observed_at: string | null;
  last_received_at: string | null;
}

export interface VesselDimensions {
  loa_m: number;
  beam_m: number;
}

export interface VesselDetail {
  mmsi: string;
  imo: number | null;
  callsign: string | null;
  ship_type: string | null;
  dimensions: VesselDimensions | null;
  destination: string | null;
  eta_text: string | null;
  draught_m: number | null;
}

export const vesselsApi = {
  search: (q: string): Promise<VesselSearchResult[]> => {
    if (!q.trim()) return Promise.resolve([]);
    const params = new URLSearchParams({ q });
    return request<VesselSearchResult[]>(`/api/v1/vessels/search?${params.toString()}`);
  },
  getDetail: (mmsi: string) => request<VesselDetail>(`/api/v1/vessels/${mmsi}`),
};

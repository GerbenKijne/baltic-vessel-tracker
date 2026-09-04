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
  // mmsi -> category, for every vessel whose type is known -- backs the
  // map's type filter, which needs this for vessels the live feed itself
  // doesn't carry identity fields for (see docs/adr/0005).
  shipTypes: () => request<Record<string, string>>("/api/v1/vessels/ship-types"),
};

import { request } from "./client";

export interface VesselSearchResult {
  mmsi: string;
  name: string | null;
  imo: number | null;
  last_observed_at: string | null;
  last_received_at: string | null;
}

export const vesselsApi = {
  search: (q: string): Promise<VesselSearchResult[]> => {
    if (!q.trim()) return Promise.resolve([]);
    const params = new URLSearchParams({ q });
    return request<VesselSearchResult[]>(`/api/v1/vessels/search?${params.toString()}`);
  },
};

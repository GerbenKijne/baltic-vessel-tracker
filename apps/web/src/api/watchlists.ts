import { request } from "./client";

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
  vessel_count: number;
}

export interface WatchlistVessel {
  mmsi: string;
  name: string | null;
  note: string | null;
  added_at: string;
  lon: number | null;
  lat: number | null;
  observed_at: string | null;
  received_at: string | null;
  freshness: string | null;
  sog_kn: number | null;
  cog_deg: number | null;
  heading_deg: number | null;
  nav_status: string | null;
  quality_flags: string[];
}

export interface WatchlistDetail {
  id: string;
  name: string;
  created_at: string;
  vessels: WatchlistVessel[];
}

export const watchlistsApi = {
  list: () => request<Watchlist[]>("/api/v1/watchlists"),
  create: (name: string) =>
    request<Watchlist>("/api/v1/watchlists", { method: "POST", body: JSON.stringify({ name }) }),
  get: (id: string) => request<WatchlistDetail>(`/api/v1/watchlists/${id}`),
  rename: (id: string, name: string) =>
    request<Watchlist>(`/api/v1/watchlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) => request<void>(`/api/v1/watchlists/${id}`, { method: "DELETE" }),
  addVessel: (id: string, mmsi: string, note?: string) =>
    request<void>(`/api/v1/watchlists/${id}/vessels/${mmsi}`, {
      method: "PUT",
      body: note ? JSON.stringify({ note }) : undefined,
    }),
  removeVessel: (id: string, mmsi: string) =>
    request<void>(`/api/v1/watchlists/${id}/vessels/${mmsi}`, { method: "DELETE" }),
};

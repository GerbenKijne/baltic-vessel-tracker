import { request } from "./client";

export interface Geofence {
  id: string;
  name: string;
  center_lon: number;
  center_lat: number;
  radius_m: number;
  enabled: boolean;
}

export interface GeofenceCreate {
  name: string;
  center_lon: number;
  center_lat: number;
  radius_m: number;
}

export const geofencesApi = {
  list: () => request<Geofence[]>("/api/v1/geofences"),
  create: (body: GeofenceCreate) =>
    request<Geofence>("/api/v1/geofences", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/api/v1/geofences/${id}`, { method: "DELETE" }),
};

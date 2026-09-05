import { request } from "./client";

export type GeofenceShape = "circle" | "polygon";

export interface Geofence {
  id: string;
  name: string;
  shape: GeofenceShape;
  center_lon: number | null;
  center_lat: number | null;
  radius_m: number | null;
  polygon: [number, number][] | null;
  enabled: boolean;
}

export interface GeofenceCreate {
  name: string;
  center_lon?: number;
  center_lat?: number;
  radius_m?: number;
  polygon?: [number, number][];
}

export const geofencesApi = {
  list: () => request<Geofence[]>("/api/v1/geofences"),
  create: (body: GeofenceCreate) =>
    request<Geofence>("/api/v1/geofences", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/api/v1/geofences/${id}`, { method: "DELETE" }),
};

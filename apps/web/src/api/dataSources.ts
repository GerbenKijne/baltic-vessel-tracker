import { request } from "./client";

export interface DataSource {
  id: string;
  name: string;
  adapter: string;
  has_api_key: boolean;
  api_key_preview: string | null;
  bounding_boxes: number[][][] | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DataSourceCreate {
  name: string;
  adapter: string;
  api_key?: string;
  bounding_boxes?: number[][][];
  enabled?: boolean;
}

export interface DataSourceUpdate {
  name?: string;
  api_key?: string;
  bounding_boxes?: number[][][];
  enabled?: boolean;
}

export const dataSourcesApi = {
  list: () => request<DataSource[]>("/api/v1/admin/data-sources"),
  create: (body: DataSourceCreate) =>
    request<DataSource>("/api/v1/admin/data-sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: DataSourceUpdate) =>
    request<DataSource>(`/api/v1/admin/data-sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    request<void>(`/api/v1/admin/data-sources/${id}`, { method: "DELETE" }),
};

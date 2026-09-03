import { request } from "./client";

export interface RetentionSettings {
  default_hours: number;
  watchlisted_days: number;
  sweep_interval_seconds: number;
  updated_at: string;
}

export interface RetentionSettingsUpdate {
  default_hours: number;
  watchlisted_days: number;
  sweep_interval_seconds: number;
}

export interface TableStorage {
  name: string;
  estimated_row_count: number;
}

export interface StorageStats {
  database_size_bytes: number;
  tables: TableStorage[];
}

export const retentionApi = {
  get: () => request<RetentionSettings>("/api/v1/admin/retention"),
  update: (body: RetentionSettingsUpdate) =>
    request<RetentionSettings>("/api/v1/admin/retention", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export const storageApi = {
  get: () => request<StorageStats>("/api/v1/admin/storage"),
};

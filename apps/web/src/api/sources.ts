import { request } from "./client";

export interface SourceStatus {
  source: string;
  instance: string;
  state: string;
  last_message_at: string | null;
  message_count: number;
  error_count: number;
  reconnect_count: number;
  error_summary: string | null;
}

export const sourcesApi = {
  list: () => request<SourceStatus[]>("/api/v1/admin/sources"),
};

import { request } from "./client";

export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_name: string;
  rule_type: string;
  mmsi: string;
  vessel_name: string | null;
  occurred_at: string;
  context: Record<string, unknown>;
  acknowledged_at: string | null;
}

export const alertEventsApi = {
  list: (acknowledged?: boolean) => {
    const params = acknowledged === undefined ? "" : `?acknowledged=${acknowledged}`;
    return request<AlertEvent[]>(`/api/v1/alert-events${params}`);
  },
  acknowledge: (id: string) =>
    request<AlertEvent>(`/api/v1/alert-events/${id}/acknowledge`, { method: "POST" }),
  acknowledgeAll: () =>
    request<{ acknowledged: number }>("/api/v1/alert-events/acknowledge-all", {
      method: "POST",
    }),
};

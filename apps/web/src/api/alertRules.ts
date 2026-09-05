import { request } from "./client";

export type AlertRuleType = "geofence_enter" | "geofence_exit" | "stale" | "speed_above";
export type AlertTargetKind = "all" | "vessel" | "watchlist";

export interface AlertRuleTarget {
  kind: AlertTargetKind;
  mmsi?: string;
  watchlist_id?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  type: AlertRuleType;
  target: AlertRuleTarget;
  params: Record<string, number | string>;
  cooldown_seconds: number;
  enabled: boolean;
  // When set, a newly-fired (non-duplicate) event for this rule also
  // adds the vessel to this watchlist -- lets a geofence (or any other)
  // rule auto-curate a list.
  add_to_watchlist_id: string | null;
  email_to: string | null;
  webhook_url: string | null;
  has_webhook_secret: boolean;
  webhook_secret_preview: string | null;
  event_count: number;
}

export interface AlertRuleWrite {
  name: string;
  type: AlertRuleType;
  target: AlertRuleTarget;
  params: Record<string, number | string>;
  cooldown_seconds: number;
  enabled: boolean;
  add_to_watchlist_id: string | null;
  email_to: string | null;
  webhook_url: string | null;
  // Omit entirely to leave a previously-saved secret unchanged (the real
  // value is never sent back by the API to prefill this).
  webhook_secret?: string;
}

export const alertRulesApi = {
  list: () => request<AlertRule[]>("/api/v1/alert-rules"),
  create: (body: AlertRuleWrite) =>
    request<AlertRule>("/api/v1/alert-rules", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<AlertRuleWrite>) =>
    request<AlertRule>(`/api/v1/alert-rules/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/api/v1/alert-rules/${id}`, { method: "DELETE" }),
};

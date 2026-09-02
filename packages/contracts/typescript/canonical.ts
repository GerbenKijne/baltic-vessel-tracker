/**
 * Canonical AIS data contracts shared with the API (see PRD SS9, SS11.1).
 * Mirrors packages/contracts/python/canonical.py. Keep both in sync by hand
 * until an OpenAPI/JSON-Schema codegen step is introduced (see docs/adr/0001).
 */

export const SCHEMA_VERSION = 1;

export type QualityFlag =
  | "stale_clock"
  | "invalid_position"
  | "suspect_speed"
  | "derived_time"
  | "conflict";

export type NavStatus =
  | "under_way_using_engine"
  | "at_anchor"
  | "not_under_command"
  | "restricted_manoeuvrability"
  | "constrained_by_draught"
  | "moored"
  | "aground"
  | "fishing"
  | "under_way_sailing"
  | "unknown";

export type Source =
  | "aisstream"
  | "barentswatch"
  | "aishub"
  | "local"
  | "licensed_se"
  | "simulator";

export interface Position {
  lon: number;
  lat: number;
}

export interface VesselUpsertMessage {
  type: "vessel.upsert";
  schema_version: number;
  server_time: string;
  mmsi: string;
  position: Position | null;
  sog_kn: number | null;
  cog_deg: number | null;
  heading_deg: number | null;
  nav_status: NavStatus | null;
  name: string | null;
  observed_at: string | null;
  received_at: string;
  source: Source;
  quality_flags: QualityFlag[];
}

export interface VesselRemoveMessage {
  type: "vessel.remove";
  schema_version: number;
  server_time: string;
  mmsi: string;
}

export interface SnapshotBeginMessage {
  type: "snapshot.begin";
  schema_version: number;
  server_time: string;
}

export interface SnapshotEndMessage {
  type: "snapshot.end";
  schema_version: number;
  server_time: string;
  count: number;
}

export interface SubscriptionAckMessage {
  type: "subscription.ack";
  schema_version: number;
  server_time: string;
  version: number;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  schema_version: number;
  server_time: string;
}

export type LiveMessage =
  | VesselUpsertMessage
  | VesselRemoveMessage
  | SnapshotBeginMessage
  | SnapshotEndMessage
  | SubscriptionAckMessage
  | HeartbeatMessage;

export interface Bbox {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface SubscriptionReplace {
  type: "subscription.replace";
  bbox: Bbox;
  watchlist_ids?: string[];
}

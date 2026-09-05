from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: str
    demo_mode: bool


class VesselOut(BaseModel):
    mmsi: str
    name: Optional[str]
    lon: Optional[float]
    lat: Optional[float]
    sog_kn: Optional[float]
    cog_deg: Optional[float]
    heading_deg: Optional[int]
    nav_status: Optional[str]
    observed_at: Optional[datetime]
    received_at: datetime
    freshness: str
    quality_flags: list[str]


class VesselListOut(BaseModel):
    vessels: list[VesselOut]
    truncated: bool


class VesselSearchResultOut(BaseModel):
    mmsi: str
    name: Optional[str]
    imo: Optional[int]
    last_observed_at: Optional[datetime]
    last_received_at: Optional[datetime]


class VesselDetailOut(BaseModel):
    mmsi: str
    imo: Optional[int]
    callsign: Optional[str]
    ship_type: Optional[str]
    dimensions: Optional[dict]
    destination: Optional[str]
    eta_text: Optional[str]
    draught_m: Optional[float]


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class WatchlistRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class WatchlistOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    vessel_count: int


class WatchlistVesselOut(BaseModel):
    mmsi: str
    name: Optional[str]
    note: Optional[str]
    added_at: datetime
    lon: Optional[float]
    lat: Optional[float]
    observed_at: Optional[datetime]
    received_at: Optional[datetime]
    freshness: Optional[str]
    sog_kn: Optional[float]
    cog_deg: Optional[float]
    heading_deg: Optional[int]
    nav_status: Optional[str]
    quality_flags: list[str]
    imo: Optional[int]
    ship_type: Optional[str]
    destination: Optional[str]


class WatchlistDetailOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    vessels: list[WatchlistVesselOut]


class WatchlistVesselAdd(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class TrackPointOut(BaseModel):
    lon: float
    lat: float
    time: datetime
    time_source: str
    sog_kn: Optional[float]
    quality_flags: list[str]
    source: str


class TrackSegmentOut(BaseModel):
    points: list[TrackPointOut]


class TrackOut(BaseModel):
    mmsi: str
    window_start: datetime
    window_end: datetime
    segments: list[TrackSegmentOut]
    point_count: int
    truncated: bool


class SourceStatusOut(BaseModel):
    source: str
    instance: str
    state: str
    last_message_at: Optional[datetime]
    message_count: int
    error_count: int
    reconnect_count: int
    error_summary: Optional[str]


class RetentionSettingsOut(BaseModel):
    default_hours: int
    watchlisted_days: int
    sweep_interval_seconds: int
    updated_at: datetime


class RetentionSettingsUpdate(BaseModel):
    default_hours: int = Field(ge=1, le=8760)  # 1 hour .. 1 year
    watchlisted_days: int = Field(ge=1, le=3650)  # 1 day .. 10 years
    sweep_interval_seconds: int = Field(ge=60, le=86400)  # 1 min .. 1 day


DATA_SOURCE_ADAPTERS = {"simulator", "aisstream"}


class DataSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    adapter: str
    api_key: Optional[str] = Field(default=None, max_length=500)
    bounding_boxes: Optional[list[list[list[float]]]] = None
    enabled: bool = True


class DataSourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    api_key: Optional[str] = Field(default=None, max_length=500)
    bounding_boxes: Optional[list[list[list[float]]]] = None
    enabled: Optional[bool] = None


class DataSourceOut(BaseModel):
    id: str
    name: str
    adapter: str
    has_api_key: bool
    api_key_preview: Optional[str]
    bounding_boxes: Optional[list[list[list[float]]]]
    enabled: bool
    created_at: datetime
    updated_at: datetime


class TableStorageOut(BaseModel):
    name: str
    estimated_row_count: int


class StorageStatsOut(BaseModel):
    database_size_bytes: int
    tables: list[TableStorageOut]


# ---------- alerts ----------
# Geofences are either a circle (center + radius, keyboard/form
# accessible without needing a map-drawing UI) or a freeform polygon
# (map-drawn only -- see docs/adr/0008). Both are stored as a real
# PostGIS polygon so geofence_enter/exit evaluation always uses the same
# ST_Covers machinery regardless of shape; the authoring inputs (center/
# radius, or the raw point list) are kept in `style` so the UI can
# redisplay and re-edit them without reverse-engineering a polygon back
# into its original shape.

ALERT_RULE_TYPES = {"geofence_enter", "geofence_exit", "stale", "speed_above"}
ALERT_TARGET_KINDS = {"all", "vessel", "watchlist"}
GEOFENCE_SHAPES = {"circle", "polygon"}


class GeofenceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # Circle shape: set these three, leave polygon unset.
    center_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    center_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    radius_m: Optional[float] = Field(default=None, gt=0, le=500_000)
    # Polygon shape: an open ring of >= 3 [lon, lat] pairs, leave the
    # circle fields unset. The router rejects any request that supplies
    # neither or both shapes.
    polygon: Optional[list[list[float]]] = None


class GeofenceOut(BaseModel):
    id: str
    name: str
    shape: str
    center_lon: Optional[float]
    center_lat: Optional[float]
    radius_m: Optional[float]
    polygon: Optional[list[list[float]]]
    enabled: bool


class AlertRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str
    target: dict
    params: dict = Field(default_factory=dict)
    cooldown_seconds: int = Field(default=1800, ge=60, le=86400)
    enabled: bool = True
    add_to_watchlist_id: Optional[str] = None
    # Delivery channels, both optional and independent of each other and
    # of the always-on in-app event log.
    email_to: Optional[EmailStr] = None
    webhook_url: Optional[str] = Field(default=None, max_length=500)
    webhook_secret: Optional[str] = Field(default=None, max_length=200)


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    type: Optional[str] = None
    target: Optional[dict] = None
    params: Optional[dict] = None
    cooldown_seconds: Optional[int] = Field(default=None, ge=60, le=86400)
    enabled: Optional[bool] = None
    # Always sent by the frontend (never omitted) alongside target/params,
    # so unlike name/cooldown_seconds/enabled this is not a "None means
    # leave unchanged" field -- None here means "clear the action".
    add_to_watchlist_id: Optional[str] = None
    email_to: Optional[EmailStr] = None
    webhook_url: Optional[str] = Field(default=None, max_length=500)
    # Unlike email_to/webhook_url above, the real secret is never echoed
    # back to the client (see AlertRuleOut), so this field can't follow
    # the "always sent" convention those use -- None here means "leave
    # the stored secret unchanged", same as DataSourceUpdate.api_key.
    # Clearing webhook_url also clears any stored secret server-side.
    webhook_secret: Optional[str] = Field(default=None, max_length=200)


class AlertRuleOut(BaseModel):
    id: str
    name: str
    type: str
    target: dict
    params: dict
    cooldown_seconds: int
    enabled: bool
    add_to_watchlist_id: Optional[str]
    email_to: Optional[str]
    webhook_url: Optional[str]
    has_webhook_secret: bool
    webhook_secret_preview: Optional[str]
    event_count: int


class AlertEventOut(BaseModel):
    id: str
    rule_id: str
    rule_name: str
    rule_type: str
    mmsi: str
    vessel_name: Optional[str]
    occurred_at: datetime
    context: dict
    acknowledged_at: Optional[datetime]


class AcknowledgeAllOut(BaseModel):
    acknowledged: int


# ---------- smtp settings ----------


class SmtpSettingsOut(BaseModel):
    host: Optional[str]
    port: int
    username: Optional[str]
    has_password: bool
    password_preview: Optional[str]
    from_address: Optional[str]
    use_tls: bool
    updated_at: datetime


class SmtpSettingsUpdate(BaseModel):
    """A full-replace PUT, same as RetentionSettingsUpdate -- the Admin
    form always submits every field. The one exception is `password`:
    since the real value is never echoed back (see SmtpSettingsOut), None
    there means "leave the stored password unchanged", same convention as
    DataSourceUpdate.api_key / AlertRuleUpdate.webhook_secret."""

    host: Optional[str] = Field(default=None, max_length=255)
    port: int = Field(ge=1, le=65535)
    username: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, max_length=500)
    from_address: Optional[EmailStr] = None
    use_tls: bool


class SmtpTestEmailIn(BaseModel):
    to: EmailStr

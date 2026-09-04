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
# Geofences are circles only (V1 scope cut -- see docs/adr or the Alerts
# feature's own commit message): center + radius, keyboard/form
# accessible without needing a map-drawing UI. Stored as a real PostGIS
# polygon (ST_Buffer of the center point) so geofence_enter/exit
# evaluation can use the same ST_Contains machinery a freeform polygon
# would need anyway; the authoring center/radius are kept in `style` so
# the UI can redisplay and re-edit them without reverse-engineering a
# polygon back into a circle.

ALERT_RULE_TYPES = {"geofence_enter", "geofence_exit", "stale", "speed_above"}
ALERT_TARGET_KINDS = {"all", "vessel", "watchlist"}


class GeofenceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    center_lon: float = Field(ge=-180, le=180)
    center_lat: float = Field(ge=-90, le=90)
    radius_m: float = Field(gt=0, le=500_000)


class GeofenceOut(BaseModel):
    id: str
    name: str
    center_lon: float
    center_lat: float
    radius_m: float
    enabled: bool


class AlertRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str
    target: dict
    params: dict = Field(default_factory=dict)
    cooldown_seconds: int = Field(default=1800, ge=60, le=86400)
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    type: Optional[str] = None
    target: Optional[dict] = None
    params: Optional[dict] = None
    cooldown_seconds: Optional[int] = Field(default=None, ge=60, le=86400)
    enabled: Optional[bool] = None


class AlertRuleOut(BaseModel):
    id: str
    name: str
    type: str
    target: dict
    params: dict
    cooldown_seconds: int
    enabled: bool
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

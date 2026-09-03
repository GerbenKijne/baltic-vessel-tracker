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

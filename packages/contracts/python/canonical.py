"""Canonical AIS data contracts shared by the API and ingestion workers.

This is the one schema provider adapters normalize into (PRD SS9). No other
module may construct application state directly from a provider payload.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

SCHEMA_VERSION = 1


class QualityFlag(str, Enum):
    STALE_CLOCK = "stale_clock"
    INVALID_POSITION = "invalid_position"
    SUSPECT_SPEED = "suspect_speed"
    DERIVED_TIME = "derived_time"
    CONFLICT = "conflict"


class NavStatus(str, Enum):
    UNDER_WAY_USING_ENGINE = "under_way_using_engine"
    AT_ANCHOR = "at_anchor"
    NOT_UNDER_COMMAND = "not_under_command"
    RESTRICTED_MANOEUVRABILITY = "restricted_manoeuvrability"
    CONSTRAINED_BY_DRAUGHT = "constrained_by_draught"
    MOORED = "moored"
    AGROUND = "aground"
    FISHING = "fishing"
    UNDER_WAY_SAILING = "under_way_sailing"
    UNKNOWN = "unknown"


class Source(str, Enum):
    AISSTREAM = "aisstream"
    BARENTSWATCH = "barentswatch"
    AISHUB = "aishub"
    LOCAL = "local"
    LICENSED_SE = "licensed_se"
    SIMULATOR = "simulator"


class Position(BaseModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)


class CanonicalAisObservation(BaseModel):
    """One normalized, validated AIS observation. See PRD SS9.1."""

    schema_version: int = SCHEMA_VERSION
    dedupe_key: str
    source: Source
    received_at: datetime
    observed_at: Optional[datetime] = None
    mmsi: str = Field(min_length=9, max_length=9)
    imo: Optional[int] = None
    message_type: Optional[int] = None
    position: Optional[Position] = None
    sog_kn: Optional[float] = None
    cog_deg: Optional[float] = Field(default=None, ge=0, lt=360)
    heading_deg: Optional[int] = Field(default=None, ge=0, le=359)
    nav_status: Optional[NavStatus] = None
    name: Optional[str] = None
    callsign: Optional[str] = None
    destination: Optional[str] = None
    quality_flags: list[QualityFlag] = Field(default_factory=list)
    raw_ref: Optional[UUID] = None

    @field_validator("mmsi")
    @classmethod
    def mmsi_must_be_digits(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("mmsi must be 9 digits")
        return v

    @field_validator("observed_at")
    @classmethod
    def observed_at_not_in_future(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None:
            now = datetime.now(timezone.utc)
            skew = (v - now).total_seconds()
            if skew > 300:
                raise ValueError("observed_at is unreasonably far in the future")
        return v


class VesselUpsertMessage(BaseModel):
    """Compact realtime update fanned out over the WebSocket gateway. See PRD SS11.1."""

    type: str = "vessel.upsert"
    schema_version: int = SCHEMA_VERSION
    server_time: datetime
    mmsi: str
    position: Optional[Position] = None
    sog_kn: Optional[float] = None
    cog_deg: Optional[float] = None
    heading_deg: Optional[int] = None
    nav_status: Optional[NavStatus] = None
    name: Optional[str] = None
    observed_at: Optional[datetime] = None
    received_at: datetime
    source: Source
    quality_flags: list[QualityFlag] = Field(default_factory=list)

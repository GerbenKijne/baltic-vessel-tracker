"""Parse + normalize a raw simulator message into a CanonicalAisObservation.

PRD SS8.1 event flow, steps 2-3. Every field is defensively bounded; a
malformed message raises ValueError so the caller can quarantine it into
raw_messages instead of crashing the worker (PRD success metric: "no process
crash from malformed provider messages").
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from canonical import CanonicalAisObservation, NavStatus, Position, Source

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

_NAV_STATUS_MAP = {
    0: NavStatus.UNDER_WAY_USING_ENGINE,
    1: NavStatus.AT_ANCHOR,
    2: NavStatus.NOT_UNDER_COMMAND,
    3: NavStatus.RESTRICTED_MANOEUVRABILITY,
    4: NavStatus.CONSTRAINED_BY_DRAUGHT,
    5: NavStatus.MOORED,
    6: NavStatus.AGROUND,
    7: NavStatus.FISHING,
    8: NavStatus.UNDER_WAY_SAILING,
}


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = _CONTROL_CHARS.sub("", value).strip()
    return cleaned or None


def compute_dedupe_key(
    source: str, mmsi: str, observed_at: datetime, lon: float, lat: float
) -> str:
    bucket = observed_at.replace(microsecond=0).isoformat()
    raw = f"{source}:{mmsi}:{bucket}:{round(lon, 4)}:{round(lat, 4)}"
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_and_normalize(
    raw: dict, source: Source, raw_ref: Optional[UUID] = None
) -> CanonicalAisObservation:
    """Raises ValueError (or pydantic.ValidationError) on a malformed message."""
    mmsi = str(raw["mmsi"]).strip()
    if not mmsi.isdigit() or len(mmsi) != 9:
        raise ValueError(f"invalid mmsi: {mmsi!r}")

    lon = float(raw["lon"])
    lat = float(raw["lat"])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError(f"position out of bounds: {lon}, {lat}")

    observed_at = datetime.fromisoformat(str(raw["timestamp"]).replace("Z", "+00:00"))
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)

    heading = raw.get("heading")
    # AIS uses 511 as the "not available" sentinel for heading.
    if heading is not None and int(heading) == 511:
        heading = None

    nav_status_raw = raw.get("nav_status")
    nav_status = (
        _NAV_STATUS_MAP.get(int(nav_status_raw), NavStatus.UNKNOWN)
        if nav_status_raw is not None
        else None
    )

    dedupe_key = compute_dedupe_key(source.value, mmsi, observed_at, lon, lat)

    return CanonicalAisObservation(
        dedupe_key=dedupe_key,
        source=source,
        received_at=datetime.now(timezone.utc),
        observed_at=observed_at,
        mmsi=mmsi,
        message_type=raw.get("message_type"),
        position=Position(lon=lon, lat=lat),
        sog_kn=raw.get("sog"),
        cog_deg=raw.get("cog"),
        heading_deg=heading,
        nav_status=nav_status,
        name=_clean_text(raw.get("name")),
        callsign=_clean_text(raw.get("callsign")),
        destination=_clean_text(raw.get("destination")),
        raw_ref=raw_ref,
    )
